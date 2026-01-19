import OpenAI from 'openai';
import axios from 'axios';

/**
 * Analyzes an image using OpenAI Vision API
 * Returns a description of what's in the image and extracts relevant information
 */
export async function analyzeImage(imageUrl: string, userContext?: string): Promise<string> {
  try {
    console.log(`Analyzing image: ${imageUrl}`);

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Download the image with Twilio authentication
    const imageResponse = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID || '',
        password: process.env.TWILIO_AUTH_TOKEN || '',
      },
    });

    // Convert to base64
    const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
    const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const prompt = userContext
      ? `The user sent this image with the message: "${userContext}"\n\nAnalyze this image and extract any relevant information. Focus on:\n- Text content (messages, notes, etc.)\n- People mentioned\n- Events or activities\n- Important details\n\nProvide a comprehensive description that captures the key information.`
      : `Analyze this image and extract any relevant information. Focus on:\n- Text content (messages, notes, etc.)\n- People mentioned\n- Events or activities\n- Important details\n\nProvide a comprehensive description that captures the key information.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const analysis = response.choices[0].message.content || 'Could not analyze image';
    console.log(`✓ Image analysis complete`);

    return analysis;
  } catch (error) {
    console.error('Image analysis failed:', error);
    throw new Error('Failed to analyze image');
  }
}
