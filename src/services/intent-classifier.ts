import OpenAI from 'openai';

export type Intent = 'store' | 'retrieve';

/**
 * Determines if the user wants to store information or retrieve information
 */
export async function determineIntent(message: string, hasMedia: boolean): Promise<Intent> {
  try {
    // If there's media attached, it's almost always storing
    if (hasMedia) {
      console.log('Media detected - defaulting to store intent');
      return 'store';
    }

    // If the message is empty or very short, assume retrieve
    if (!message || message.trim().length < 3) {
      return 'retrieve';
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `Determine if this message is trying to STORE information or RETRIEVE information.

STORE examples:
- "I just had a great conversation with Sarah about her new job"
- "Here's a screenshot of my chat with Mike"
- "Remember that I'm meeting John tomorrow at 3pm"
- "Add this to my notes: Sarah likes coffee"
- Any message with context about people, events, or things to remember

RETRIEVE examples:
- "Tell me about Sarah"
- "What did I do yesterday?"
- "When did I last talk to Mike?"
- "Show me my notes"
- Questions asking for information

Return ONLY valid JSON:
{
  "intent": "store" | "retrieve",
  "confidence": number (0-1)
}

Message: "${message}"`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that classifies user intent. You ONLY respond with valid JSON.',
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
      return 'retrieve'; // Default to retrieve if unclear
    }

    const result = JSON.parse(content);
    console.log(`Intent classification: ${result.intent} (confidence: ${result.confidence})`);

    return result.intent === 'store' ? 'store' : 'retrieve';
  } catch (error) {
    console.error('Intent classification failed:', error);
    return 'retrieve'; // Default to retrieve on error
  }
}
