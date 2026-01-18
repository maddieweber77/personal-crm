import axios from 'axios';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

/**
 * Downloads an audio recording from Twilio and saves it locally
 *
 * @param recordingUrl - The URL of the Twilio recording
 * @param callSid - The unique Twilio call identifier (used for filename)
 * @returns The local file path where the audio was saved
 */
export async function downloadRecording(
  recordingUrl: string,
  callSid: string
): Promise<string> {
  // Construct the local file path
  // Format: audio-files/CALL_SID_TIMESTAMP.wav
  const timestamp = Date.now();
  const filename = `${callSid}_${timestamp}.wav`;
  const localPath = join(process.cwd(), 'audio-files', filename);

  try {
    console.log(`Downloading recording from: ${recordingUrl}`);

    // Download the audio file as a stream
    // Twilio requires HTTP Basic Auth (account SID + auth token)
    const response = await axios({
      method: 'GET',
      url: recordingUrl,
      responseType: 'stream',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID || '',
        password: process.env.TWILIO_AUTH_TOKEN || '',
      },
    });

    // Save the stream to a file
    const writeStream = createWriteStream(localPath);
    await pipeline(response.data, writeStream);

    console.log(`✓ Recording saved to: ${localPath}`);
    return localPath;
  } catch (error) {
    console.error('Failed to download recording:', error);
    throw new Error(`Failed to download recording from ${recordingUrl}`);
  }
}

// TODO Phase 2: Upload to S3 instead of saving locally
// This will require:
// - Installing @aws-sdk/client-s3
// - Configuring AWS credentials
// - Modifying this function to upload to S3 and return S3 URL
