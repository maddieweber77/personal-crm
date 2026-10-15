import { askClaudeForText } from './claude';

// Person extraction moved to person-resolver.ts (it now matches against
// the people already saved instead of creating a new person per name).

/**
 * Generate a daily summary from a transcript
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
    console.log('Generating daily summary...');

    const summary = await askClaudeForText({
      system: `You summarize Maddie's personal voice journal entries in 3-4 sentences: the main activities of the day, the emotional tone, and the important interactions. Third person, past tense ("She spent time with..."). Return only the summary.`,
      user: transcript,
      maxTokens: 2000,
    });

    console.log('✓ Daily summary generated');
    return summary;
  } catch (error) {
    console.error('Summary generation failed:', error instanceof Error ? error.message : String(error));
    throw new Error('Failed to generate daily summary');
  }
}
