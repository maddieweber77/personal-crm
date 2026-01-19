import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import sendgrid from '@sendgrid/mail';
import { downloadRecording } from '../services/audio-downloader';
import { transcribeAudio } from '../services/transcription';
import { extractPeopleFromTranscript, generateDailySummary } from '../services/llm';
import { handleQuery } from '../services/retrieval';
import { determineIntent } from '../services/intent-classifier';
import { handleStoreRequest } from '../services/store-handler';
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
    const body = req.body.Body || '';
    const numMedia = parseInt(req.body.NumMedia || '0');
    const mediaUrls: string[] = [];

    // Collect all media URLs if present
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = req.body[`MediaUrl${i}`];
      if (mediaUrl) {
        mediaUrls.push(mediaUrl);
      }
    }

    console.log('\n=== Incoming SMS ===');
    console.log(`From: ${from}`);
    console.log(`Message: ${body}`);
    console.log(`Media count: ${numMedia}`);
    if (mediaUrls.length > 0) {
      console.log(`Media URLs:`, mediaUrls);
    }

    // Security: Only allow messages from Maddie's number
    const ALLOWED_NUMBER = '+17049997750';
    if (from !== ALLOWED_NUMBER) {
      console.log(`⛔ Rejected SMS from unauthorized number: ${from}`);
      res.status(200).send(); // Respond with empty to prevent retries
      return;
    }

    // Determine intent: storing info or retrieving info
    const intent = await determineIntent(body, mediaUrls.length > 0);
    console.log(`Intent detected: ${intent}`);

    let responseText: string;

    if (intent === 'store') {
      // User is sending information to store
      responseText = await handleStoreRequest(body, mediaUrls);
    } else {
      // User is querying for information
      responseText = await handleQuery(body);
    }

    console.log(`Response: ${responseText}`);

    // Respond to Twilio immediately
    res.status(200).send();

    // Try to send via SMS (but don't wait for success/failure)
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
    } catch (smsError) {
      console.log('⚠️ SMS send failed');
      console.error('SMS Error:', smsError);
    }

    // ALWAYS send via email as well (for permanent record)
    await sendEmailFallback(body, responseText);
    console.log('✓ Response sent via email');
  } catch (error) {
    console.error('Error processing SMS:', error);
    res.status(500).send('Error processing request');
  }
});

/**
 * Send response via email using SendGrid
 */
async function sendEmailFallback(query: string, response: string): Promise<void> {
  try {
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'maddieweber7@gmail.com';
    const toEmail = 'maddieweber7@gmail.com';

    console.log(`Attempting to send email...`);
    console.log(`From: ${fromEmail}`);
    console.log(`To: ${toEmail}`);
    console.log(`API Key configured: ${sendgridApiKey ? 'Yes' : 'No'}`);

    if (!sendgridApiKey) {
      console.error('⚠️ SendGrid API key not configured - email disabled');
      console.log('To enable email, set SENDGRID_API_KEY in Railway');
      return;
    }

    // Initialize SendGrid
    sendgrid.setApiKey(sendgridApiKey);

    // Send email via SendGrid API
    const result = await sendgrid.send({
      from: fromEmail,
      to: toEmail,
      subject: `CRM Query: "${query}"`,
      text: `Your Query:\n${query}\n\n---\n\nResponse:\n${response}`,
    });

    console.log(`✓ SendGrid response:`, JSON.stringify(result[0], null, 2));
  } catch (error: any) {
    console.error('❌ Failed to send email - FULL ERROR:');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error response:', JSON.stringify(error.response?.body, null, 2));
    console.error('Full error:', error);
  }
}

export default router;
