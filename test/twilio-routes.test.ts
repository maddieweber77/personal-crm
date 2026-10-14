import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import express from 'express';
import twilio from 'twilio';
import webhookRouter from '../src/routes/webhook';

// Same wiring as src/index.ts, so this proves the mount path, router order
// and real urlencoded parsing — not just the middleware in isolation.
const TOKEN = 'test-auth-token-routes';
const PUBLIC_HOST = 'personal-crm.example.app';
let server: Server;
let port = 0;

before(async () => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  delete process.env.PUBLIC_BASE_URL;
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', webhookRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as AddressInfo).port;
});

after(() => server.close());

// node:http (not fetch) so the Host header can be set to the public host.
function send(path: string, params: Record<string, string>, headers: Record<string, string>) {
  const body = new URLSearchParams(params).toString();
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function post(path: string, params: Record<string, string>, opts: { sign?: boolean; proto?: string } = {}) {
  const headers: Record<string, string> = { host: PUBLIC_HOST, 'x-forwarded-proto': opts.proto ?? 'https' };
  if (opts.sign) {
    headers['x-twilio-signature'] = twilio.getExpectedTwilioSignature(TOKEN, `https://${PUBLIC_HOST}${path}`, params);
  }
  return send(path, params, headers);
}

// A From that is NOT the allowlisted number, so no route reaches OpenAI/Twilio.
const STRANGER = { From: '+15550001234', CallSid: 'CA123', Body: 'hi & 100% 😀' };

for (const route of ['recording-complete', 'sms', 'voice']) {
  test(`unsigned POST /api/twilio/${route} is rejected`, async () => {
    const res = await post(`/api/twilio/${route}`, STRANGER);
    assert.equal(res.status, 403);
  });
}

test('signed voice call from a stranger reaches the route (reject TwiML)', async () => {
  const res = await post('/api/twilio/voice', STRANGER, { sign: true });
  assert.equal(res.status, 200);
  assert.match(res.text, /This number is private/);
});

test('signed SMS from a stranger reaches the route and is ignored', async () => {
  const res = await post('/api/twilio/sms', STRANGER, { sign: true });
  assert.equal(res.status, 200);
});

test('signed recording callback without RecordingUrl reaches validation (400)', async () => {
  const res = await post('/api/twilio/recording-complete', { CallSid: 'CA123' }, { sign: true });
  assert.equal(res.status, 400);
});

test('multiple X-Forwarded-Proto values use the first (https)', async () => {
  const res = await post('/api/twilio/voice', STRANGER, { sign: true, proto: 'https,http' });
  assert.equal(res.status, 200);
});

test('a signature for the http:// URL is rejected', async () => {
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `http://${PUBLIC_HOST}/api/twilio/sms`, STRANGER);
  const res = await send('/api/twilio/sms', STRANGER, { host: PUBLIC_HOST, 'x-forwarded-proto': 'https', 'x-twilio-signature': sig });
  assert.equal(res.status, 403);
});
