import OpenAI from 'openai';
import { createReadStream } from 'fs';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transcribes an audio file to text using OpenAI's Whisper API
 *
 * @param audioFilePath - Path to the local audio file
 * @returns The full transcript as a string
 */
export async function transcribeAudio(
  audioFilePath: string
): Promise<string> {
  try {
    console.log(`Transcribing audio file: ${audioFilePath}`);

    // Create a read stream from the audio file
    const audioStream = createReadStream(audioFilePath);

    // Call OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-1',
      language: 'en', // Specify English for better accuracy
      response_format: 'text', // Get plain text instead of JSON
    });

    console.log(`✓ Transcription completed (${transcription.length} characters)`);
    return transcription;
  } catch (error) {
    console.error('Transcription failed:', error);
    throw new Error(`Failed to transcribe audio file: ${audioFilePath}`);
  }
}
