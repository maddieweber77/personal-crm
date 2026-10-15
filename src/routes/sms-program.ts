import { Router, Request, Response } from 'express';

/**
 * Public pages that describe the SMS program behind our toll-free number.
 *
 * Carriers only deliver texts from a toll-free number after Twilio verifies
 * it, and the verification form asks for public links showing how the
 * recipient opted in, plus terms and a privacy policy. These pages are
 * those links. They contain no personal data and need no login.
 *
 * If what the app sends ever changes (who gets texts, how often, why),
 * update these pages first: they are a promise to the carriers.
 */

export const SMS_PROGRAM_NAME = 'Sleepy Saturday Daily Reminders';
export const SMS_NUMBER_DISPLAY = '(888) 739-1743';
const CONTACT_EMAIL = 'hello@sleepysaturday.com';
const LAST_UPDATED = 'October 14, 2026';

const router = Router();

/** Wrap page content in a small, readable HTML document. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 680px;
         margin: 0 auto; padding: 32px 16px; line-height: 1.55; color: #1d1d1f; background: #fff; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; margin-top: 1.8em; }
  .sample { background: #f2f2f7; border-radius: 12px; padding: 12px 14px; margin: 8px 0; }
  footer { margin-top: 2.5em; font-size: 0.9rem; color: #6e6e73; }
  a { color: #0a58ca; }
</style>
</head>
<body>
${body}
<footer>
  ${SMS_PROGRAM_NAME} is operated by Sleepy Saturday LLC, New York, NY.
  Questions: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
  <br><a href="/sms">Program &amp; opt-in</a> · <a href="/sms/terms">Terms</a> · <a href="/sms/privacy">Privacy</a>
  <br>Last updated ${LAST_UPDATED}.
</footer>
</body>
</html>`;
}

/** Program description and how consent is given (the "opt-in proof" link). */
router.get('/sms', (_req: Request, res: Response) => {
  res.type('html').send(page(`${SMS_PROGRAM_NAME}: how to opt in`, `
<h1>${SMS_PROGRAM_NAME}</h1>
<p>${SMS_PROGRAM_NAME} is a private reminder service that Sleepy Saturday LLC runs for its
owner, Madelyn Weber. It texts her a short morning summary of her calendar appointments and
personal reminders, and answers questions she texts to it.</p>

<h2>Who receives these messages</h2>
<p>Only the business owner, at her own mobile number. The service is not offered to the
public or to customers, nobody else is ever enrolled, and no phone numbers are bought,
rented, or imported from lists.</p>

<h2>How opt-in works</h2>
<p>The owner set up this service for herself and enrolled her own mobile number. She opts in
by texting <strong>START</strong> to <strong>${SMS_NUMBER_DISPLAY}</strong>. Texts only ever go to that
one enrolled number.</p>
<p>Consent is not a condition of any purchase or service.</p>

<h2>What you'll receive</h2>
<ul>
  <li>A daily reminder digest at about 7:30am Eastern.</li>
  <li>Replies to questions the owner texts to ${SMS_NUMBER_DISPLAY}.</li>
</ul>
<p>Message frequency varies, typically 1–3 messages per day. Msg &amp; data rates may apply.</p>
<div class="sample">Good morning! Wed Oct 15:<br>• 8:00 AM Dentist (Main St Dental)<br>• 6:30 PM Dinner with Grace</div>

<h2>Help and opting out</h2>
<p>Reply <strong>STOP</strong> at any time to stop all messages. Reply <strong>HELP</strong> for help,
or email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Reply <strong>START</strong> to opt back in.</p>
<p>See the <a href="/sms/terms">messaging terms</a> and <a href="/sms/privacy">privacy policy</a>.</p>
`));
});

/** Messaging terms (the "terms and conditions URL"). */
router.get('/sms/terms', (_req: Request, res: Response) => {
  res.type('html').send(page(`${SMS_PROGRAM_NAME}: terms`, `
<h1>${SMS_PROGRAM_NAME}: messaging terms</h1>
<ol>
  <li><strong>Program.</strong> ${SMS_PROGRAM_NAME} sends a daily reminder digest and replies to
  questions, from ${SMS_NUMBER_DISPLAY}, only to the mobile number of Sleepy Saturday LLC's owner.</li>
  <li><strong>Opt-in.</strong> Text START to ${SMS_NUMBER_DISPLAY}. Consent is not a condition of any purchase.</li>
  <li><strong>Frequency.</strong> Message frequency varies, typically 1–3 messages per day.</li>
  <li><strong>Cost.</strong> Msg &amp; data rates may apply, according to your mobile plan.</li>
  <li><strong>Opt-out.</strong> Reply STOP at any time to cancel. You'll receive one confirmation
  message and no further messages unless you text START again.</li>
  <li><strong>Help.</strong> Reply HELP, or email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</li>
  <li><strong>Delivery.</strong> Carriers are not liable for delayed or undelivered messages.</li>
  <li><strong>Privacy.</strong> See our <a href="/sms/privacy">privacy policy</a>.</li>
</ol>
`));
});

/** Privacy policy for the SMS program (the "privacy policy URL"). */
router.get('/sms/privacy', (_req: Request, res: Response) => {
  res.type('html').send(page(`${SMS_PROGRAM_NAME}: privacy`, `
<h1>${SMS_PROGRAM_NAME}: privacy policy</h1>
<h2>What we collect</h2>
<p>The enrolled mobile number, the messages sent to and from ${SMS_NUMBER_DISPLAY}, and the
reminder content the owner chooses to store (for example calendar appointments and notes).</p>
<h2>How we use it</h2>
<p>Only to run this reminder service: building and sending the digest and answering the
owner's questions.</p>
<h2>Sharing</h2>
<p>We do not sell, rent, or share mobile numbers, SMS opt-in data, or consent with third
parties or affiliates for marketing or promotional purposes. Data is processed only by the
service providers that run this service (SMS delivery, email delivery, hosting, and AI
processing), and only to provide it.</p>
<h2>Your choices</h2>
<p>Reply STOP to stop messages. To ask about or delete stored data, email
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
`));
});

export default router;
