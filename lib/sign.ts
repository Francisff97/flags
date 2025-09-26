import crypto from 'crypto';

const SECRET = process.env.SIGNING_SECRET!;
if (!SECRET) throw new Error('Missing SIGNING_SECRET');

export function signPayload(payload: any) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

export function verifySignature(payload: any, signature?: string | null) {
  if (!signature) return false;
  const expected = signPayload(payload);
  // timing-safe compare
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
