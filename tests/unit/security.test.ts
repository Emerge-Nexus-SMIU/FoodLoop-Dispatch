import { describe, it, expect } from 'vitest';
import { base32, totp, totpCounter, encrypt, decrypt } from '../../src/server/crypto';
import { readJson } from '../../src/lib/http';
import { csvCell } from '../../src/server/operations';
import 'dotenv/config';
describe('security primitives', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const)('matches RFC 6238 vector at %s', (time, code) =>
    expect(totp(secret, Math.floor(time / 30), 8)).toBe(code),
  );
  it('bounds authenticator clock tolerance and rejects malformed codes', () => {
    const at = Date.now(),
      n = Math.floor(at / 30000);
    expect(totpCounter(secret, totp(secret, n), at)).toBe(n);
    expect(totpCounter(secret, totp(secret, n + 3), at)).toBeNull();
    expect(totpCounter(secret, 'invalid', at)).toBeNull();
  });
  it('encrypts private mail/authenticator payloads with authenticated randomized encryption', () => {
    const a = encrypt('private link'),
      b = encrypt('private link');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('private link');
    const parts = a.split('.');
    parts[2] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it.each(['=HYPERLINK("bad")', '+SUM(1,2)', '@danger', '-payload', '\t=cmd'])(
    'neutralizes CSV spreadsheet formulas %s',
    (value) => expect(csvCell(value)).toMatch(/^"'/),
  );
  it('escapes CSV delimiters and quotes', () => expect(csvCell('a,"b"')).toBe('"a,""b"""'));
  it('limits chunked request bodies without relying on content-length', async () => {
    const request = new Request('http://localhost', {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(9000));
          c.enqueue(new Uint8Array(9000));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects malformed JSON', async () =>
    expect(
      readJson(new Request('http://localhost', { method: 'POST', body: '{invalid' })),
    ).rejects.toMatchObject({ status: 422 }));
});
