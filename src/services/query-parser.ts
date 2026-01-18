import OpenAI from 'openai';

export type QueryType = 'person' | 'date' | 'recent' | 'unknown';

export interface ParsedQuery {
  type: QueryType;
  personName?: string;
  date?: string;
  days?: number;
}

/**
 * Parses a natural language query to determine what information to retrieve
 */
export async function parseQuery(userQuery: string): Promise<ParsedQuery> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Get current date for context
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const prompt = `Parse this user query and determine what information they want to retrieve.

IMPORTANT: Today's date is ${todayStr}. Yesterday was ${yesterdayStr}.

Query types:
- "person": Asking about a specific person (e.g., "Tell me about Sarah", "What do I know about Mike?")
- "date": Asking about a specific date (e.g., "What did I do yesterday?", "Tell me about January 15", "my day today")
- "recent": Asking about recent activity (e.g., "What happened this week?", "Recent updates")
- "unknown": Cannot determine what they want

Return ONLY valid JSON in this exact format:
{
  "type": "person" | "date" | "recent" | "unknown",
  "personName": "string (if type is person)",
  "date": "YYYY-MM-DD (if type is date)",
  "days": number (if type is recent, how many days back)
}

Examples:
- "Tell me about Sarah" → {"type": "person", "personName": "Sarah"}
- "What did I do yesterday?" → {"type": "date", "date": "${yesterdayStr}"}
- "What happened this week?" → {"type": "recent", "days": 7}
- "Tell me about my day today" → {"type": "date", "date": "${todayStr}"}

User query: ${userQuery}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that parses natural language queries. You ONLY respond with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return { type: 'unknown' };
    }

    const parsed = JSON.parse(content) as ParsedQuery;
    console.log(`✓ Query parsed: ${JSON.stringify(parsed)}`);

    return parsed;
  } catch (error) {
    console.error('Query parsing failed:', error);
    return { type: 'unknown' };
  }
}
