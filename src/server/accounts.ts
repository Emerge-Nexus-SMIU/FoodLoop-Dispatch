import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import { db } from './db';
import { type Actor, rateLimit } from './auth';
import { ensure } from './errors';
import { encrypt, decrypt, tokenHash, base32, totpCounter } from './crypto';
import { queueMail } from './mail';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
export async function securityAudit(
  t: Prisma.TransactionClient,
  userId: string,
  action: string,
  entityId = userId,
  organizationId?: string,
) {
  await t.auditEvent.create({
    data: {
      actorId: userId,
      organizationId,
      entityType: 'Account',
      entityId,
      action,
      correlationId: randomUUID(),
    },
  });
}
export function appOrigin() {
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
  const u = new URL(origin);
  ensure(
    u.origin === origin &&
      (!['http:', 'https:'].includes(u.protocol)
        ? false
        : process.env.NODE_ENV !== 'production' ||
          u.protocol === 'https:' ||
          ['localhost', '127.0.0.1'].includes(u.hostname)),
    503,
    'ORIGIN_CONFIG',
    'Configure a valid application origin',
  );
  return origin;
}
export async function issueAction(
  t: Prisma.TransactionClient,
  kind: string,
  email: string,
  userId?: string,
  organizationId?: string,
  role?: string,
) {
  const raw = randomBytes(32).toString('hex');
  await t.actionToken.create({
    data: {
      kind,
      email,
      userId,
      organizationId,
      role,
      tokenHash: tokenHash(raw),
      expiresAt: new Date(Date.now() + (kind === 'RESET' ? 30 * 60000 : 24 * 3600000)),
    },
  });
  return raw;
}
export async function requestAction(email: string, kind: 'RESET' | 'VERIFY', actor?: Actor) {
  email = z.email().max(200).parse(email.toLowerCase());
  await rateLimit(`action:${kind}:${tokenHash(email)}`, 3, 3600);
  if (kind === 'VERIFY')
    ensure(actor?.email === email, 403, 'FORBIDDEN', 'Use your own email address');
  const user = await db.user.findUnique({ where: { email } });
  if (user?.active && (kind === 'RESET' || !user.emailVerifiedAt)) {
    await db.$transaction(async (t) => {
      const raw = await issueAction(t, kind, email, user.id);
      const link = `${appOrigin()}/${kind === 'RESET' ? 'reset-password' : 'verify-email'}?token=${raw}`;
      await queueMail(t, {
        to: email,
        subject:
          kind === 'RESET'
            ? 'Reset your FoodLoop Dispatch password'
            : 'Verify your FoodLoop Dispatch email',
        text: `${kind === 'RESET' ? 'Reset your password' : 'Verify your email address'}: ${link}\nThis link is time-limited and can be used once. If you did not request it, ignore this message.`,
      });
      await securityAudit(t, user.id, `${kind}_REQUESTED`);
    });
  }
  return {
    message: 'If the account is eligible, a time-limited link has been queued for delivery.',
  };
}
export async function consumeAction(raw: string, kind: 'RESET' | 'VERIFY', password?: string) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(raw);
  const passwordHash =
    kind === 'RESET'
      ? await hash(
          z
            .string()
            .min(12)
            .max(72)
            .refine(
              (v) => Buffer.byteLength(v, 'utf8') <= 72,
              'Password is limited to 72 UTF-8 bytes',
            )
            .parse(password),
          12,
        )
      : undefined;
  return db.$transaction(async (t) => {
    const action = await t.actionToken.findUnique({ where: { tokenHash: tokenHash(raw) } });
    ensure(
      action &&
        action.kind === kind &&
        action.userId &&
        !action.consumedAt &&
        action.expiresAt > new Date(),
      422,
      'INVALID_LINK',
      'Link is invalid, expired or already used',
    );
    const used = await t.actionToken.updateMany({
      where: { id: action.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    ensure(used.count === 1, 409, 'LINK_USED', 'Link has already been used');
    const user = await t.user.findUnique({ where: { id: action.userId } });
    ensure(
      user?.active && user.email === action.email,
      422,
      'INVALID_LINK',
      'Account is no longer eligible',
    );
    await t.user.update({
      where: { id: user.id },
      data: kind === 'RESET' ? { passwordHash } : { emailVerifiedAt: new Date() },
    });
    if (kind === 'RESET') {
      await t.session.deleteMany({ where: { userId: user.id } });
      await t.actionToken.updateMany({
        where: { userId: user.id, kind: 'RESET', consumedAt: null },
        data: { consumedAt: new Date() },
      });
    }
    await securityAudit(t, user.id, kind === 'RESET' ? 'PASSWORD_RESET' : 'EMAIL_VERIFIED');
    return {
      message: kind === 'RESET' ? 'Password updated. Sign in again.' : 'Email address verified.',
    };
  });
}
export async function changePassword(a: Actor, input: unknown) {
  await rateLimit(`password:${a.id}`, 5, 600);
  const v = z
    .object({
      currentPassword: z.string().max(128),
      newPassword: z
        .string()
        .min(12)
        .max(72)
        .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is limited to 72 UTF-8 bytes'),
    })
    .parse(input);
  ensure(
    await compare(v.currentPassword, a.passwordHash),
    403,
    'AUTH_FAILED',
    'Current password is incorrect',
  );
  const passwordHash = await hash(v.newPassword, 12);
  await db.$transaction(async (t) => {
    await t.user.update({ where: { id: a.id }, data: { passwordHash } });
    await t.session.deleteMany({ where: { userId: a.id } });
    await securityAudit(t, a.id, 'PASSWORD_CHANGED');
  });
  return { message: 'Password changed. All sessions have been revoked.' };
}
export async function listSessions(a: Actor, currentHash: string) {
  return (
    await db.session.findMany({
      where: { userId: a.id, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  ).map((s) => ({ ...s, current: s.id === currentHash }));
}
export async function revokeSessions(a: Actor, id?: string) {
  const result = await db.$transaction(async (t) => {
    const count = await t.session.deleteMany({ where: { userId: a.id, ...(id ? { id } : {}) } });
    await securityAudit(t, a.id, 'SESSIONS_REVOKED');
    return count;
  });
  return { revoked: result.count };
}
export async function beginMfa(a: Actor, password: string) {
  await rateLimit(`mfa:${a.id}`, 5, 600);
  ensure(
    await compare(password, a.passwordHash),
    403,
    'AUTH_FAILED',
    'Current password is incorrect',
  );
  ensure(!a.mfaSecret, 409, 'MFA_ENABLED', 'Authenticator is already enabled');
  const secret = base32(randomBytes(20));
  await db.user.update({ where: { id: a.id }, data: { mfaPendingSecret: encrypt(secret) } });
  return {
    secret,
    uri: `otpauth://totp/FoodLoop%20Dispatch:${encodeURIComponent(a.email)}?secret=${secret}&issuer=FoodLoop%20Dispatch&algorithm=SHA1&digits=6&period=30`,
  };
}
export async function enableMfa(a: Actor, code: string, currentSessionHash?: string) {
  await rateLimit(`mfa:${a.id}`, 8, 600);
  ensure(a.mfaPendingSecret && !a.mfaSecret, 409, 'MFA_SETUP', 'Begin authenticator setup first');
  const counter = totpCounter(decrypt(a.mfaPendingSecret), code);
  ensure(counter !== null, 422, 'INVALID_MFA', 'Authenticator code is invalid');
  const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex'));
  await db.$transaction(async (t) => {
    const changed = await t.user.updateMany({
      where: { id: a.id, mfaSecret: null, mfaPendingSecret: a.mfaPendingSecret },
      data: {
        mfaSecret: a.mfaPendingSecret,
        mfaPendingSecret: null,
        mfaLastCounter: BigInt(counter),
        recoveryHashes: recoveryCodes.map(tokenHash),
      },
    });
    ensure(changed.count === 1, 409, 'MFA_CHANGED', 'Authenticator setup changed; try again');
    await t.session.deleteMany({
      where: { userId: a.id, ...(currentSessionHash ? { id: { not: currentSessionHash } } : {}) },
    });
    await securityAudit(t, a.id, 'MFA_ENABLED');
  });
  return { recoveryCodes };
}
export async function verifyMfa(userId: string, code: string) {
  await rateLimit(`mfa-login:${userId}`, 8, 300);
  return db.$transaction(async (t) => {
    const u = await t.user.findUniqueOrThrow({ where: { id: userId } });
    ensure(u.mfaSecret, 403, 'MFA_REQUIRED', 'Authenticator is not configured');
    const counter = totpCounter(decrypt(u.mfaSecret), code);
    if (counter !== null) {
      const result = await t.user.updateMany({
        where: {
          id: userId,
          OR: [{ mfaLastCounter: null }, { mfaLastCounter: { lt: BigInt(counter) } }],
        },
        data: { mfaLastCounter: BigInt(counter) },
      });
      ensure(
        result.count === 1,
        401,
        'INVALID_MFA',
        'Authenticator code is invalid or already used',
      );
    } else {
      const digest = tokenHash(code);
      ensure(
        u.recoveryHashes.includes(digest),
        401,
        'INVALID_MFA',
        'Authenticator or recovery code is invalid',
      );
      const result = await t.user.updateMany({
        where: { id: userId, recoveryHashes: { equals: u.recoveryHashes } },
        data: { recoveryHashes: u.recoveryHashes.filter((v) => v !== digest) },
      });
      ensure(result.count === 1, 401, 'INVALID_MFA', 'Recovery code already used');
    }
    await securityAudit(t, userId, 'MFA_CHALLENGE_PASSED');
    return true;
  });
}
export async function disableMfa(a: Actor, password: string, code: string) {
  ensure(
    await compare(password, a.passwordHash),
    403,
    'AUTH_FAILED',
    'Current password is incorrect',
  );
  await verifyMfa(a.id, code);
  await db.$transaction(async (t) => {
    await t.user.update({
      where: { id: a.id },
      data: { mfaSecret: null, mfaPendingSecret: null, mfaLastCounter: null, recoveryHashes: [] },
    });
    await t.session.deleteMany({ where: { userId: a.id } });
    await securityAudit(t, a.id, 'MFA_DISABLED');
  });
  return { message: 'Authenticator disabled. All sessions revoked.' };
}
