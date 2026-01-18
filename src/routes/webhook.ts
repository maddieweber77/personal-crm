import { Router, Request, Response } from 'express';
import { downloadRecording } from '../services/audio-downloader';
import { transcribeAudio } from '../services/transcription';
import { extractPeopleFromTranscript, generateDailySummary } from '../services/llm';
import {
  createVoiceEntry,
  findPersonByNameOrAlias,
  createPerson,
  createPersonUpdate,
  upsertDailySummary,
} from '../database/client';

const router = Router();

/**
 * Twilio webhook endpoint - called when a recording is completed
 *
 * Expected POST body from Twilio:
 * - RecordingUrl: URL to download the recording
 * - CallSid: Unique call identifier
 * - RecordingDuration: Length in seconds (optional)
 * - Timestamp: When the call occurred (optional)
 */
router.post('/twilio/recording-complete', async (req: Request, res: Response) => {
  try {
    // Extract data from Twilio webhook
    const recordingUrl = req.body.RecordingUrl;
    const callSid = req.body.CallSid;
    const timestamp = req.body.Timestamp || new Date().toISOString();

    console.log('\n=== New recording received ===');
    console.log(`Call SID: ${callSid}`);
    console.log(`Recording URL: ${recordingUrl}`);

    // Validate required fields
    if (!recordingUrl || !callSid) {
      res.status(400).json({ error: 'Missing required fields: RecordingUrl or CallSid' });
      return;
    }

    // Respond to Twilio immediately (prevents timeout)
    // The processing will continue in the background
    res.status(200).json({ status: 'processing' });

    // === STEP 1: Download the recording ===
    const audioPath = await downloadRecording(recordingUrl, callSid);

    // === STEP 2: Transcribe the audio ===
    const transcript = await transcribeAudio(audioPath);

    // === STEP 3: Store voice entry in database ===
    const voiceEntry = await createVoiceEntry(
      new Date(timestamp),
      audioPath,
      transcript
    );
    console.log(`✓ Voice entry created: ${voiceEntry.id}`);

    // === STEP 4: Run LLM Pass A - Extract people and updates ===
    const personExtractionResult = await extractPeopleFromTranscript(transcript);

    // === STEP 5: Process each person and their updates ===
    for (const extractedPerson of personExtractionResult.people) {
      // Try to find existing person by name or alias
      let person = await findPersonByNameOrAlias(extractedPerson.name);

      // If not found, create new person
      if (!person) {
        person = await createPerson(
          extractedPerson.name,
          extractedPerson.aliases,
          extractedPerson.relationship
        );
        console.log(`✓ Created new person: ${person.name}`);
      } else {
        console.log(`✓ Found existing person: ${person.name}`);
      }

      // Create person_updates for each update
      for (const update of extractedPerson.updates) {
        await createPersonUpdate(
          person.id,
          voiceEntry.id,
          update.update_text,
          update.context
        );
      }
      console.log(`✓ Created ${extractedPerson.updates.length} updates for ${person.name}`);
    }

    // === STEP 6: Run LLM Pass B - Generate daily summary ===
    const summary = await generateDailySummary(transcript);

    // === STEP 7: Upsert daily summary ===
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    await upsertDailySummary(today, summary);
    console.log(`✓ Daily summary updated for ${today}`);

    console.log('=== Processing complete ===\n');
  } catch (error) {
    // Log error but don't fail - Twilio already got 200 response
    console.error('Error processing recording:', error);
  }
});

export default router;
