import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (process.env.NODE_ENV === 'production')
  throw new Error('Development configuration is not allowed in production.');
if (!fs.existsSync('.env')) fs.copyFileSync('.env.example', '.env');
let text = fs.readFileSync('.env', 'utf8');
if (!process.env.AUTH_ENCRYPTION_KEY && !/^AUTH_ENCRYPTION_KEY=[a-f0-9]{64}$/im.test(text)) {
  text = text.replace(/^AUTH_ENCRYPTION_KEY=.*\n?/m, '');
  text += '\nAUTH_ENCRYPTION_KEY=' + randomBytes(32).toString('hex') + '\n';
  fs.writeFileSync('.env', text, { mode: 0o600 });
  fs.chmodSync('.env', 0o600);
}
if (!/^OPERATING_COUNTRY=/m.test(text)) {
  fs.appendFileSync('.env', '\nOPERATING_COUNTRY=PK\n');
}
console.log(
  'Local configuration preserved and account-encryption key initialized. No secrets displayed.',
);
