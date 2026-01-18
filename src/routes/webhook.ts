import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import { downloadRecording } from '../services/audio-downloader';
import { transcribeAudio } from '../services/transcription';
import { extractPeopleFromTranscript, generateDailySummary } from '../services/llm';
import { handleQuery } from '../services/retrieval';
import {
  createVoiceEntry,
  findPersonByNameOrAlias,
  createPerson,
  createPersonUpdate,
  getDailySummary,
  upsertDailySummary,
} from '../database/client';

const router = Router();

/**
 * Twilio voice webhook - called when someone calls your Twilio number
 *
 * This returns TwiML (XML) that tells Twilio to:
 * 1. Play a greeting message
 * 2. Start recording
 * 3. Send the recording to /api/twilio/recording-complete when done
 */
router.post('/twilio/voice', (req: Request, res: Response) => {
  console.log('\n=== Incoming call ===');
  console.log(`Call SID: ${req.body.CallSid}`);
  console.log(`From: ${req.body.From}`);

  // Security: Only allow calls from Maddie's number
  const ALLOWED_NUMBER = '+17049997750';
  const callerNumber = req.body.From;

  if (callerNumber !== ALLOWED_NUMBER) {
    console.log(`⛔ Rejected call from unauthorized number: ${callerNumber}`);

    // Return TwiML that rejects the call
    const rejectTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This number is private. Goodbye.</Say>
  <Hangup/>
</Response>`;

    res.type('text/xml');
    res.send(rejectTwiml);
    return;
  }

  console.log('✓ Call authorized');

  // Build the TwiML response
  // TwiML is XML that tells Twilio what to do
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hello Maddie! Tell me about your day and the people you interacted with. When you're done, just hang up. XOXO</Say>
  <Record
    maxLength="300"
    playBeep="true"
    recordingStatusCallback="/api/twilio/recording-complete"
    recordingStatusCallbackMethod="POST"
  />
  <Say voice="Polly.Joanna">Thank you. Goodbye.</Say>
</Response>`;

  // Send TwiML response with correct content type
  res.type('text/xml');
  res.send(twiml);
});

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
    const newSummary = await generateDailySummary(transcript);

    // === STEP 7: Append to existing daily summary (don't overwrite) ===
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const existingSummary = await getDailySummary(today);

    // If there's already a summary today, append as new paragraph
    // Otherwise, use the new summary as-is
    const finalSummary = existingSummary
      ? `${existingSummary}\n\n${newSummary}`
      : newSummary;

    await upsertDailySummary(today, finalSummary);
    console.log(`✓ Daily summary updated for ${today}`);

    console.log('=== Processing complete ===\n');
  } catch (error) {
    // Log error but don't fail - Twilio already got 200 response
    console.error('Error processing recording:', error);
  }
});

/**
 * SMS webhook endpoint - handles incoming text messages
 * Processes queries and responds via SMS or email
 */
router.post('/twilio/sms', async (req: Request, res: Response) => {
  try {
    const from = req.body.From;
    const body = req.body.Body;

    console.log('\n=== Incoming SMS ===');
    console.log(`From: ${from}`);
    console.log(`Message: ${body}`);

    // Security: Only allow messages from Maddie's number
    const ALLOWED_NUMBER = '+17049997750';
    if (from !== ALLOWED_NUMBER) {
      console.log(`⛔ Rejected SMS from unauthorized number: ${from}`);
      res.status(200).send(); // Respond with empty to prevent retries
      return;
    }

    // Process the query
    const responseText = await handleQuery(body);
    console.log(`Response: ${responseText}`);

    // Try to send via SMS first
    try {
      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      await twilioClient.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to: from,
        body: responseText,
      });

      console.log('✓ Response sent via SMS');
      res.status(200).send();
    } catch (smsError) {
      // SMS failed - send via email instead
      console.log('⚠️ SMS send failed, falling back to email...');
      console.error('SMS Error:', smsError);

      await sendEmailFallback(body, responseText);
      console.log('✓ Response sent via email');
      res.status(200).send();
    }
  } catch (error) {
    console.error('Error processing SMS:', error);
    res.status(500).send('Error processing request');
  }
});

/**
 * Send response via email (fallback when SMS fails)
 */
async function sendEmailFallback(query: string, response: string): Promise<void> {
  try {
    const gmailUser = process.env.GMAIL_USER;
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailAppPassword) {
      console.error('⚠️ Gmail credentials not configured - email fallback disabled');
      console.log('To enable email fallback, set GMAIL_USER and GMAIL_APP_PASSWORD in Railway');
      return;
    }

    // Create Gmail transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    // Send email
    await transporter.sendMail({
      from: gmailUser,
      to: gmailUser, // Send to yourself
      subject: `CRM Query: "${query}"`,
      text: `Your Query:\n${query}\n\n---\n\nResponse:\n${response}`,
    });
  } catch (error) {
    console.error('Failed to send email fallback:', error);
  }
}

export default router;
