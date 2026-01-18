import OpenAI from 'openai';
import type { PersonExtractionResult } from '../types';

/**
 * Pass A: Extract structured person data from transcript
 *
 * Given a transcript, this extracts:
 * - People mentioned
 * - Their relationships
 * - Updates about them
 *
 * @param transcript - The voice call transcript
 * @returns Structured data about people and their updates
 */
export async function extractPeopleFromTranscript(
  transcript: string
): Promise<PersonExtractionResult> {
  try {
    console.log('Running LLM Pass A: Person extraction...');

    // Initialize OpenAI client here (lazy initialization)
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `You are analyzing a personal voice journal entry. Extract information about people mentioned.

For each person mentioned, extract:
- Their name
- Any nicknames or aliases used to refer to them
- Their relationship to the speaker (friend, family, coworker, or unknown if unclear)
- Any updates or information shared about them

IMPORTANT RULES:
1. If you're unsure about someone's identity, still include them
2. Do NOT try to deduplicate or merge people - include each mention separately
3. Capture the context around each update

Return ONLY valid JSON in this exact format:
{
  "people": [
    {
      "name": "string",
      "aliases": ["string"],
      "relationship": "friend" | "family" | "coworker" | "unknown",
      "updates": [
        {
          "update_text": "string",
          "context": "string"
        }
      ]
    }
  ]
}

If no people are mentioned, return: {"people": []}

Transcript:
${transcript}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that extracts structured data from voice transcripts. You ONLY respond with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent extraction
      response_format: { type: 'json_object' }, // Ensure JSON response
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content in LLM response');
    }

    const result = JSON.parse(content) as PersonExtractionResult;
    console.log(`✓ Extracted ${result.people.length} people from transcript`);

    return result;
  } catch (error) {
    console.error('Person extraction failed:', error);
    throw new Error('Failed to extract people from transcript');
  }
}

/**
 * Pass B: Generate a daily summary from transcript
 *
 * Creates a 3-4 sentence summary of the day based on what was said
 *
 * @param transcript - The voice call transcript
 * @returns A concise daily summary
 */
export async function generateDailySummary(
  transcript: string
): Promise<string> {
  try {
    console.log('Running LLM Pass B: Daily summary generation...');

    // Initialize OpenAI client here (lazy initialization)
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `You are summarizing a personal voice journal entry.

Create a 3-4 sentence summary that captures:
- The main themes or activities of the day
- Key emotional tones or reflections
- Important events or interactions

Keep it concise and natural, written in third person past tense (e.g., "They spent time with...", "They reflected on...").

Transcript:
${transcript}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that creates concise, insightful summaries of personal journal entries.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5, // Slightly higher for more natural language
      max_tokens: 150, // Limit to keep summary concise
    });

    const summary = response.choices[0].message.content;
    if (!summary) {
      throw new Error('No content in LLM response');
    }

    console.log('✓ Daily summary generated');
    return summary.trim();
  } catch (error) {
    console.error('Summary generation failed:', error);
    throw new Error('Failed to generate daily summary');
  }
}

// TODO Phase 2: Add embeddings generation
// This will enable semantic search across memories
// Will require:
// - Generating embeddings for each person_update
// - Storing embeddings in a vector column (pgvector extension)
// - Creating similarity search functions
