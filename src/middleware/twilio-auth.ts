import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';

/**
 * Rebuild the public URL Twilio called, so the signature check hashes the
 * same string Twilio signed. Railway terminates TLS, so the app sees plain
 * http internally; X-Forwarded-Proto carries the original https.
 * PUBLIC_BASE_URL (e.g. https://my-app.up.railway.app) overrides both.
 */
export function publicUrl(req: Request): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (base) return `${base}${req.originalUrl}`;
  const proto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Only let requests through that Twilio really sent (X-Twilio-Signature).
 * Fails closed: no auth token configured means nothing gets through.
 */
export function requireTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.get('x-twilio-signature');
  if (!authToken || !signature) {
    res.status(403).send('Forbidden');
    return;
  }
  const valid = twilio.validateRequest(authToken, signature, publicUrl(req), req.body || {});
  if (!valid) {
    console.log(`⛔ Rejected request with invalid Twilio signature: ${req.method} ${req.path}`);
    res.status(403).send('Forbidden');
    return;
  }
  next();
}

/**
 * Twilio recordings and MMS media are served from api.twilio.com. We only
 * attach our Twilio credentials to requests going there.
 */
export function isTwilioApiUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'api.twilio.com';
  } catch {
    return false;
  }
}
