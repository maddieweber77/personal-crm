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
- Any upcoming EVENTS mentioned (birthdays, weddings, trips, interviews, surgeries, etc.)
- Any ongoing SITUATIONS they're dealing with (breakup, sick family, wedding planning, new job, tough time, etc.)

IMPORTANT RULES FOR EVENTS:
1. Extract specific dates when mentioned (e.g., "March 15", "next Tuesday")
2. If only approximate timing (e.g., "next month", "in a few weeks"), put that in event_date_approximate
3. Event types: birthday, wedding, trip, interview, surgery, other
4. Only extract FUTURE events or events that need follow-up

IMPORTANT RULES FOR SITUATIONS:
1. Situations are ongoing challenges/life events requiring support
2. Severity levels:
   - high: Major life events (death, serious illness, breakup, job loss)
   - medium: Challenging but manageable (wedding planning, new job adjustment, family stress)
   - low: Minor ongoing things (busy season, minor health issue)
3. Situation types: breakup, sick_family, wedding_planning, new_job, tough_time, other
4. started_at should be the approximate date mentioned or today's date

IMPORTANT RULE FOR CONTACT TRACKING:
Set "mentioned_contact" to TRUE if the speaker explicitly mentions:
- Talking to, texting, calling, or seeing someone
- Having a conversation, meeting, or interaction with someone
- Examples: "I talked to Sarah today", "I saw Mike yesterday", "I texted Grace"
Set to FALSE if they only mention someone in passing without interaction.

Return ONLY valid JSON in this exact format:
{
  "mentioned_contact": boolean,
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
      ],
      "events": [
        {
          "event_type": "birthday" | "wedding" | "trip" | "interview" | "surgery" | "other",
          "event_description": "string",
          "event_date": "YYYY-MM-DD" | null,
          "event_date_approximate": "string" | null
        }
      ],
      "situations": [
        {
          "situation_type": "breakup" | "sick_family" | "wedding_planning" | "new_job" | "tough_time" | "other",
          "situation_description": "string",
          "severity": "high" | "medium" | "low",
          "started_at": "YYYY-MM-DD"
        }
      ]
    }
  ]
}

If no people are mentioned, return: {"mentioned_contact": false, "people": []}

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
