import twilio from 'twilio';

/**
 * Sends an SMS reminder to call and check in
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

    // Send the SMS
    const message = await client.messages.create({
      body: '📞 Time to check in! Call your journal line and share what\'s on your mind. 💭',
      from: fromNumber,
      to: toNumber,
    });

    console.log(`✓ Reminder SMS sent: ${message.sid}`);
  } catch (error) {
    console.error('Failed to send reminder SMS:', error);
  }
}
