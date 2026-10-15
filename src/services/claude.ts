import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

/**
 * One place for how this app talks to Claude.
 *
 * Model and effort come from env so they can change without a deploy:
 *   CLAUDE_MODEL  (default claude-opus-5-5)
 *   CLAUDE_EFFORT (default medium: low | medium | high | xhigh | max)
 */
export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || 'claude-opus-5-5';
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function claudeEffort(): Effort {
  const value = process.env.CLAUDE_EFFORT as Effort;
  return EFFORTS.includes(value) ? value : 'medium';
}

let client: Anthropic | null = null;

// Lazy, like the other API clients here: env vars are loaded by then.
function getClient(): Anthropic {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

/**
 * Ask Claude for JSON matching `schema` and return it already parsed.
 *
 * - The system prompt is cached (it's identical every call).
 * - If a safety classifier declines, Anthropic retries on its recommended
 *   fallback model server-side (`fallbacks: "default"`).
 * - Throws if the answer is a refusal, got cut off, or doesn't match the schema,
 *   so callers never store half an answer.
 */
export async function askClaudeForJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const response = await getClient().beta.messages.parse({
    model: claudeModel(),
    max_tokens: opts.maxTokens ?? 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: claudeEffort(), format: betaZodOutputFormat(opts.schema) },
    system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined (${response.stop_details?.category ?? 'no category'})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude answer was cut off (max_tokens)');
  }
  if (response.parsed_output == null) {
    throw new Error('Claude answer did not match the expected JSON shape');
  }
  return response.parsed_output as z.infer<S>;
}

/** Ask Claude for plain text (e.g. a summary). */
export async function askClaudeForText(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: claudeModel(),
    max_tokens: opts.maxTokens ?? 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined (${response.stop_details?.category ?? 'no category'})`);
  }
  // Thinking blocks can come first; only read the text blocks.
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();
  if (!text) throw new Error('Claude returned no text');
  return text;
}
