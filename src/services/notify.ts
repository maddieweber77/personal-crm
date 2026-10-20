import twilio from 'twilio';
import sendgrid from '@sendgrid/mail';
import nodemailer from 'nodemailer';

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
const TO_EMAIL = 'maddieweber7@gmail.com';

/**
 * Send an email to Maddie. Uses her own Gmail (GMAIL_APP_PASSWORD) when set,
 * otherwise SendGrid (SENDGRID_API_KEY). Returns true/false, never throws.
 */
export async function sendEmail(subject: string, text: string): Promise<boolean> {
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (gmailPassword) return sendWithGmail(subject, text, gmailPassword);

  const sendgridApiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || TO_EMAIL;

  if (!sendgridApiKey) {
    console.error('⚠️ No email configured (set GMAIL_APP_PASSWORD or SENDGRID_API_KEY) - email skipped');
    return false;
  }

  try {
    sendgrid.setApiKey(sendgridApiKey);
    await sendgrid.send({ from: fromEmail, to: TO_EMAIL, subject, text });
    console.log('✓ Email sent');
    return true;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.error(`Failed to send email${code ? ` (SendGrid status ${code})` : ''}: ${errorMessage(error)}`);
    return false;
  }
}

/** Gmail SMTP with an app password: Maddie emailing herself from her own account. */
async function sendWithGmail(subject: string, text: string, appPassword: string): Promise<boolean> {
  const user = process.env.GMAIL_USER || TO_EMAIL;
  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      // Google shows app passwords with spaces ("abcd efgh ..."); SMTP wants them without.
      auth: { user, pass: appPassword.replace(/\s+/g, '') },
    });
    await transport.sendMail({ from: `Personal CRM <${user}>`, to: TO_EMAIL, subject, text });
    console.log('✓ Email sent (Gmail)');
    return true;
  } catch (error) {
    const code = (error as { responseCode?: unknown } | null)?.responseCode;
    console.error(`Failed to send email${code ? ` (Gmail SMTP ${code})` : ''}: ${errorMessage(error)}`);
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
