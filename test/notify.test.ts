import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { sendEmail } from '../src/services/notify';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; mock.restoreAll(); });

test('sendEmail uses Gmail when GMAIL_APP_PASSWORD is set (spaces stripped)', async () => {
  process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
  delete process.env.GMAIL_USER;
  const sent: any[] = [];
  let auth: any;
  mock.method(nodemailer, 'createTransport', (opts: any) => {
    auth = opts.auth;
    return { sendMail: async (m: any) => { sent.push(m); return {}; } } as any;
  });
  mock.method(console, 'log', () => {});
  assert.equal(await sendEmail('Subject', 'Body'), true);
  assert.deepEqual(auth, { user: 'maddieweber7@gmail.com', pass: 'abcdefghijklmnop' });
  assert.equal(sent[0].to, 'maddieweber7@gmail.com');
  assert.equal(sent[0].subject, 'Subject');
});

test('sendEmail returns false (never throws) when Gmail rejects', async () => {
  process.env.GMAIL_APP_PASSWORD = 'wrong';
  mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async () => { throw Object.assign(new Error('Invalid login'), { responseCode: 535 }); },
  }) as any);
  const errors: string[] = [];
  mock.method(console, 'error', (m: string) => { errors.push(m); });
  assert.equal(await sendEmail('S', 'B'), false);
  assert.match(errors[0], /Gmail SMTP 535/);
  assert.doesNotMatch(errors[0], /wrong/); // never logs the password
});

test('sendEmail returns false when no email service is configured', async () => {
  delete process.env.GMAIL_APP_PASSWORD;
  delete process.env.SENDGRID_API_KEY;
  mock.method(console, 'error', () => {});
  assert.equal(await sendEmail('S', 'B'), false);
});
