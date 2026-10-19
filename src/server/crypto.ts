import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ensure } from './errors';
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
function key() {
  const v = process.env.AUTH_ENCRYPTION_KEY;
  ensure(
    v && /^[a-f0-9]{64}$/i.test(v),
    503,
    'SECURITY_CONFIG',
    'Account security is not configured',
  );
  return Buffer.from(v, 'hex');
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((v) => v.toString('base64url')).join('.');
}
export function decrypt(value: string) {
  const [iv, tag, body] = value.split('.').map((v) => Buffer.from(v, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(value: Buffer) {
  let bits = 0,
    acc = 0,
    out = '';
  for (const b of value) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(acc >>> bits) & 31];
    }
  }
  if (bits) out += alphabet[(acc << (5 - bits)) & 31];
  return out;
}
function decode32(value: string) {
  let bits = 0,
    acc = 0;
  const bytes: number[] = [];
  for (const c of value) {
    const n = alphabet.indexOf(c);
    ensure(n >= 0, 422, 'INVALID_SECRET', 'Invalid authenticator secret');
    acc = (acc << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret: string, counter: number, digits = 6) {
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', decode32(secret)).update(time).digest();
  const at = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export function totpCounter(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const counter = Math.floor(now / 30000);
  for (const c of [counter - 1, counter, counter + 1])
    if (timingSafeEqual(Buffer.from(totp(secret, c)), Buffer.from(code))) return c;
  return null;
}
