import { z } from 'zod';
export type ReleaseIssue = { code: string; message: string };
export function releaseIssues(env: Record<string, string | undefined>) {
  const issues: ReleaseIssue[] = [];
  const add = (condition: unknown, code: string, message: string) => {
    if (!condition) issues.push({ code, message });
  };
  let origin: URL | null;
  try {
    origin = new URL(env.APP_ORIGIN ?? '');
  } catch {
    origin = null;
  }
  add(
    origin?.protocol === 'https:' &&
      !['localhost', '127.0.0.1'].includes(origin?.hostname ?? '') &&
      origin?.origin === env.APP_ORIGIN,
    'APP_ORIGIN',
    'Configure the exact public HTTPS origin',
  );
  add(
    /^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY ?? ''),
    'AUTH_ENCRYPTION_KEY',
    'Configure a private 32-byte encryption key in the hosting secret manager',
  );
  add(
    env.MAIL_TRANSPORT === 'resend' &&
      env.RESEND_API_KEY &&
      z.email().safeParse(env.MAIL_FROM).success,
    'MAIL_PROVIDER',
    'Configure transactional email with an approved verified sender',
  );
  add(
    z.email().safeParse(env.SUPPORT_EMAIL).success &&
      !/\.(test|invalid)$/.test(env.SUPPORT_EMAIL ?? ''),
    'SUPPORT_EMAIL',
    'Owner must select and verify a real support address',
  );
  add(
    env.BUSINESS_NAME?.trim(),
    'BUSINESS_NAME',
    'Owner must confirm the exact registered operating entity',
  );
  add(env.OPERATING_COUNTRY === 'PK', 'OPERATING_COUNTRY', 'Initial release is scoped to Pakistan');
  add(
    env.LEGAL_APPROVED === 'true',
    'LEGAL_APPROVAL',
    'Owner/legal review of Pakistan terms, privacy, food-handling responsibilities and license is outstanding',
  );
  add(
    Number.isInteger(Number(env.RETENTION_DAYS)) && Number(env.RETENTION_DAYS) > 0,
    'RETENTION_POLICY',
    'Owner must approve a retention/deletion policy',
  );
  add(
    env.ALLOW_DEMO_SEED !== 'true' && env.ALLOW_DEMO_LOGIN !== 'true',
    'DEMO_CONFIG',
    'Disable demo seeding and fixture login for a public deployment',
  );
  add(env.NODE_ENV === 'production', 'NODE_ENV', 'Use production runtime mode');
  return issues;
}
