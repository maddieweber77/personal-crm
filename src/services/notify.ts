import twilio from 'twilio';
import sendgrid from '@sendgrid/mail';

/**
 * Small "send a text" / "send an email" helpers for the morning digest.
 * Both return true/false instead of throwing, so one failing never stops
 * the other.
 *
 * Errors are logged as message (+ code) only: the error OBJECTS from Twilio
 * and SendGrid can carry the request's auth header.
 */

/**
 * Send a text message. Returns true when Twilio ACCEPTED it (it can still
 * fail to deliver later, e.g. error 30032 for an unverified toll-free number;
 * that shows up in the Twilio console, not here).
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.error('⚠️ Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER) - SMS skipped');
    return false;
  }

  try {
    const client = twilio(accountSid, authToken);
    const message = await client.messages.create({ from, to, body });
    console.log(`✓ SMS accepted by Twilio (${message.sid}, status: ${message.status})`);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`Failed to send SMS${code ? ` (Twilio error ${code})` : ''}: ${errorMessage(error)}`);
    return false;
  }
}

/** Email Maddie (same settings and defaults as the friend reminder emails). */
export async function sendEmail(subject: string, text: string): Promise<boolean> {
  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'maddieweber7@gmail.com';
  const toEmail = 'maddieweber7@gmail.com';

  if (!sendgridApiKey) {
    console.error('⚠️ SendGrid API key not configured - email skipped');
    return false;
  }

  try {
    sendgrid.setApiKey(sendgridApiKey);
    await sendgrid.send({ from: fromEmail, to: toEmail, subject, text });
    console.log('✓ Email sent');
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`Failed to send email${code ? ` (SendGrid status ${code})` : ''}: ${errorMessage(error)}`);
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
