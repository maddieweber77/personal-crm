import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { requireTwilioSignature, isTwilioApiUrl, publicUrl } from '../src/middleware/twilio-auth';
import { toDayCount } from '../src/database/client';

const TOKEN = 'test-auth-token-0123456789abcdef';
const HOST = 'personal-crm.example.app';
const PATH = '/api/twilio/recording-complete';
const BODY = { CallSid: 'CA123', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1' };

function fakeReq(headers: Record<string, string>, body = BODY) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: 'POST',
    path: PATH,
    originalUrl: PATH,
    protocol: 'http', // what the app sees behind Railway's TLS proxy
    body,
    get: (name: string) => lower[name.toLowerCase()],
  } as any;
}

function run(req: any) {
  const result = { status: 0, nextCalled: false };
  const res = {
    status(code: number) { result.status = code; return this; },
    send() { return this; },
  } as any;
  requireTwilioSignature(req, res, () => { result.nextCalled = true; });
  return result;
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  delete process.env.PUBLIC_BASE_URL;
});

test('accepts a request Twilio signed for the public https URL', () => {
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `https://${HOST}${PATH}`, BODY);
  const r = run(fakeReq({ host: HOST, 'x-forwarded-proto': 'https', 'x-twilio-signature': sig }));
  assert.equal(r.nextCalled, true);
});

test('rejects a request with no signature', () => {
  const r = run(fakeReq({ host: HOST, 'x-forwarded-proto': 'https' }));
  assert.equal(r.nextCalled, false);
  assert.equal(r.status, 403);
});

test('rejects a signature made with a different token', () => {
  const sig = twilio.getExpectedTwilioSignature('some-other-token', `https://${HOST}${PATH}`, BODY);
  const r = run(fakeReq({ host: HOST, 'x-forwarded-proto': 'https', 'x-twilio-signature': sig }));
  assert.equal(r.status, 403);
});

test('rejects when the body was changed after signing', () => {
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `https://${HOST}${PATH}`, BODY);
  const changed = { ...BODY, RecordingUrl: 'https://example.com/other' };
  const r = run(fakeReq({ host: HOST, 'x-forwarded-proto': 'https', 'x-twilio-signature': sig }, changed));
  assert.equal(r.status, 403);
});

test('fails closed when no auth token is configured', () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  const sig = twilio.getExpectedTwilioSignature(TOKEN, `https://${HOST}${PATH}`, BODY);
  const r = run(fakeReq({ host: HOST, 'x-forwarded-proto': 'https', 'x-twilio-signature': sig }));
  assert.equal(r.status, 403);
});

test('PUBLIC_BASE_URL overrides the forwarded headers', () => {
  process.env.PUBLIC_BASE_URL = 'https://override.example.app/';
  assert.equal(publicUrl(fakeReq({ host: HOST })), `https://override.example.app${PATH}`);
});

test('isTwilioApiUrl only allows https://api.twilio.com', () => {
  assert.equal(isTwilioApiUrl('https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1'), true);
  assert.equal(isTwilioApiUrl('http://api.twilio.com/x'), false);
  assert.equal(isTwilioApiUrl('https://api.twilio.com.example.com/x'), false);
  assert.equal(isTwilioApiUrl('https://example.com/?u=https://api.twilio.com'), false);
  assert.equal(isTwilioApiUrl('not a url'), false);
  assert.equal(isTwilioApiUrl(undefined), false);
});

test('toDayCount coerces to a safe whole number', () => {
  assert.equal(toDayCount(7, 30), 7);
  assert.equal(toDayCount('14', 30), 14);
  assert.equal(toDayCount(2.9, 30), 2);
  assert.equal(toDayCount("1 day'; DROP TABLE people;--", 30), 30);
  assert.equal(toDayCount(undefined, 30), 30);
  assert.equal(toDayCount(-5, 30), 0);
  assert.equal(toDayCount(1e9, 30), 3650);
});
