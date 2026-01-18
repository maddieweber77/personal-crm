import twilio from 'twilio';

/**
 * Makes a voice call reminder to check in
 */
export async function sendCheckInReminder(): Promise<void> {
  try {
    // Initialize Twilio client
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const toNumber = '+17049997750'; // Maddie's number

    if (!fromNumber) {
      console.error('⚠️ TWILIO_PHONE_NUMBER not set in environment variables');
      return;
    }

    // Make a voice call with TwiML
    const call = await client.calls.create({
      from: fromNumber,
      to: toNumber,
      // TwiML says the reminder message
      twiml: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hey Maddie! This is your check-in reminder. Time to call your journal line and share what's on your mind.</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">Have a great day!</Say>
</Response>`
    });

    console.log(`✓ Reminder call initiated: ${call.sid}`);
  } catch (error) {
    console.error('Failed to make reminder call:', error);
  }
}
