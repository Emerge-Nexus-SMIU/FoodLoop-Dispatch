import { randomBytes, createHash } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { cookies } from 'next/headers';
import { db } from './db';
import { ensure } from './errors';
export function localDemoMode() {
  try {
    return (
      process.env.ALLOW_DEMO_LOGIN === 'true' &&
      ['localhost', '127.0.0.1'].includes(new URL(process.env.APP_ORIGIN ?? '').hostname)
    );
  } catch {
    return false;
  }
}
export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function currentUser(token?: string) {
  const raw = token ?? (await cookies()).get('foodloop_session')?.value;
  if (!raw) return null;
  const s = await db.session.findUnique({
    where: { id: sessionHash(raw) },
    include: { user: { include: { memberships: { include: { organization: true } } } } },
  });
  return s && s.expiresAt > new Date() && s.user.active ? s.user : null;
}
export type Actor = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export async function rateLimit(key: string, max: number, seconds = 60) {
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "RateLimit" (key,count,"resetsAt") VALUES (${key},1,NOW()+${seconds}*INTERVAL '1 second') ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "RateLimit"."resetsAt"<=NOW() THEN 1 ELSE "RateLimit".count+1 END,"resetsAt"=CASE WHEN "RateLimit"."resetsAt"<=NOW() THEN NOW()+${seconds}*INTERVAL '1 second' ELSE "RateLimit"."resetsAt" END RETURNING count`;
  ensure(rows[0].count <= max, 429, 'RATE_LIMIT', 'Too many attempts. Try again later.');
}
export async function login(email: string, password: string, mfaCode?: string) {
  await rateLimit(`login:${sessionHash(email.toLowerCase())}`, 10, 300);
  const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  const valid = await compare(
    password,
    u?.passwordHash ?? '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5G01WjtdvxVP1R5XH4BkwMoVTXQwEYm',
  );
  ensure(u?.active && valid, 401, 'AUTH_FAILED', 'Invalid email or password');
  ensure(
    !(
      process.env.NODE_ENV === 'production' &&
      !localDemoMode() &&
      (await db.membership.count({ where: { userId: u.id, organization: { demo: true } } }))
    ),
    403,
    'DEMO_DISABLED',
    'Demo accounts are disabled in production',
  );
  ensure(
    !(
      process.env.NODE_ENV === 'production' &&
      !localDemoMode() &&
      u.email.endsWith('@demo.foodloop.test')
    ),
    403,
    'DEMO_DISABLED',
    'Demo accounts are disabled in production',
  );
  if (u.mfaSecret) {
    ensure(mfaCode, 401, 'MFA_REQUIRED', 'Enter an authenticator or recovery code');
    await (await import('./accounts')).verifyMfa(u.id, mfaCode);
  }
  return createSession(u.id);
}
export async function createSession(userId: string) {
  const raw = randomBytes(32).toString('hex');
  await db.session.create({
    data: { id: sessionHash(raw), userId, expiresAt: new Date(Date.now() + 8 * 3600000) },
  });
  return raw;
}
export async function register(name: string, email: string, password: string) {
  await rateLimit(`register:${sessionHash(email)}`, 3, 3600);
  const passwordHash = await hash(password, 12);
  const { issueAction, appOrigin } = await import('./accounts');
  const { queueMail } = await import('./mail');
  const user = await db.$transaction(async (t) => {
    const user = await t.user.create({ data: { name, email: email.toLowerCase(), passwordHash } });
    const token = await issueAction(t, 'VERIFY', user.email, user.id);
    await queueMail(t, {
      to: user.email,
      subject: 'Verify your FoodLoop Dispatch email',
      text: `Verify your email: ${appOrigin()}/verify-email?token=${token}\nThis link expires in 24 hours and can be used once.`,
    });
    return user;
  });
  return createSession(user.id);
}
export function membership(a: Actor, role?: string) {
  return a.memberships.find((m) => !role || m.role === role);
}
export function requireRole(a: Actor, role: string) {
  ensure(
    a.emailVerifiedAt,
    403,
    'EMAIL_UNVERIFIED',
    'Verify your email address before using organization operations',
  );
  const m = membership(a, role);
  ensure(m, 403, 'FORBIDDEN', 'This action requires a different role');
  return m;
}
export function requireAdmin(a: Actor) {
  ensure(a.platformAdmin, 403, 'FORBIDDEN', 'Platform administrator required');
  ensure(a.emailVerifiedAt, 403, 'EMAIL_UNVERIFIED', 'Verify your email address first');
  ensure(
    process.env.NODE_ENV !== 'production' || a.mfaSecret || localDemoMode(),
    403,
    'ADMIN_MFA_REQUIRED',
    'Enable an authenticator before administering a production network',
  );
}
