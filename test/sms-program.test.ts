import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import smsProgramRouter, { SMS_NUMBER_DISPLAY } from '../src/routes/sms-program';
import { isCarrierKeyword } from '../src/routes/webhook';

let server: Server;
let base = '';

before(async () => {
  const app = express();
  app.use(smsProgramRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

async function get(path: string) {
  const res = await fetch(base + path);
  return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() };
}

test('opt-in page explains who gets texts, how to opt in, and STOP/HELP', async () => {
  const { status, type, text } = await get('/sms');
  assert.equal(status, 200);
  assert.match(type, /text\/html/);
  assert.ok(text.includes(SMS_NUMBER_DISPLAY));
  assert.match(text, /Only the business owner/);
  assert.match(text, /<strong>START<\/strong>/);
  assert.match(text, /<strong>STOP<\/strong>/);
  assert.match(text, /<strong>HELP<\/strong>/);
  assert.match(text, /Msg &amp; data rates may apply/);
  assert.match(text, /not a condition of any purchase/);
});

test('terms page covers frequency, cost, opt-out, help and carrier liability', async () => {
  const { status, text } = await get('/sms/terms');
  assert.equal(status, 200);
  for (const phrase of [/Message frequency varies/, /Msg &amp; data rates may apply/, /Reply STOP/, /Reply HELP/, /Carriers are not liable/]) {
    assert.match(text, phrase);
  }
});

test('privacy page says opt-in data is never shared for marketing', async () => {
  const { status, text } = await get('/sms/privacy');
  assert.equal(status, 200);
  assert.match(text, /do not sell, rent, or share mobile numbers, SMS opt-in data, or consent/);
});

test('pages are public: no Twilio signature needed', async () => {
  // Contrast with /api/twilio/*, which 403s without a signature.
  for (const path of ['/sms', '/sms/terms', '/sms/privacy']) {
    assert.equal((await get(path)).status, 200, path);
  }
});

test('isCarrierKeyword matches whole-message keywords only', () => {
  for (const body of ['STOP', 'stop', ' Help ', 'start', 'UNSUBSCRIBE', 'yes']) {
    assert.equal(isCarrierKeyword(body), true, body);
  }
  for (const body of ['stop by Sarah tomorrow', 'help me remember Grace', 'Starting a new job', '', 'yes!']) {
    assert.equal(isCarrierKeyword(body), false, body);
  }
});
