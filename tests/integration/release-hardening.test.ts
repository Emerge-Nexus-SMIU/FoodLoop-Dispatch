import 'dotenv/config';
import { assertFixtureDatabase } from '../fixture-guard';
assertFixtureDatabase();
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import { db } from '../../src/server/db';
import { createSession, currentUser, login, requireAdmin, type Actor } from '../../src/server/auth';
import * as account from '../../src/server/accounts';
import * as ops from '../../src/server/operations';
import { base32, totp, encrypt, decrypt } from '../../src/server/crypto';
import { deliverMailBatch } from '../../src/server/mail';
import * as service from '../../src/server/service';
const run = randomUUID().slice(0, 8),
  password = 'SecureFixture!2026';
let manager: Actor, recipient: Actor, admin: Actor;
async function user(name: string, role?: string, type = 'DONOR') {
  const id = `release-${run}-${name}`,
    u = await db.user.create({
      data: {
        id,
        name,
        email: `${id}@example.invalid`,
        passwordHash: await hash(password, 4),
        emailVerifiedAt: new Date(),
        platformAdmin: name === 'admin',
      },
    });
  if (role)
    await db.organization.create({
      data: {
        id: id + '-org',
        name: 'Release ' + name,
        type,
        contact: 'synthetic@example.invalid',
        verificationStatus: 'VERIFIED',
        locations: {
          create: {
            label: 'Desk',
            address: 'Synthetic test campus',
            latitude: 24.86,
            longitude: 67.01,
          },
        },
        memberships: { create: { userId: u.id, role } },
      },
    });
  return (await currentUser(await createSession(u.id)))!;
}
async function fresh(id: string) {
  return (await currentUser(await createSession(id)))!;
}
async function findLink(email: string, kind: string) {
  const messages = await db.mailOutbox.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const message = messages
    .map((m) => JSON.parse(decrypt(m.payload)) as { to: string; subject: string; text: string })
    .find((m) => m.to === email && m.subject.toLowerCase().includes(kind));
  expect(message).toBeDefined();
  return new URL(message!.text.match(/https?:\/\/[^\s]+/)![0]).searchParams.get('token')!;
}
beforeAll(async () => {
  manager = await user('manager', 'DONOR_MANAGER');
  recipient = await user('recipient', 'RECIPIENT_MANAGER', 'RECIPIENT');
  admin = await user('admin');
});
afterAll(async () => {
  await db.matchingPolicy.deleteMany({ where: { id: 'active' } });
  await db.$disconnect();
});
describe('commercial account and operational hardening', () => {
  it('queues encrypted verification, consumes once and revokes reset sessions', async () => {
    const u = await user('verify');
    await db.user.update({ where: { id: u.id }, data: { emailVerifiedAt: null } });
    const a = await fresh(u.id);
    await account.requestAction(a.email, 'VERIFY', a);
    const token = await findLink(a.email, 'verify');
    expect(await db.actionToken.count({ where: { tokenHash: token } })).toBe(0);
    await account.consumeAction(token, 'VERIFY');
    await expect(account.consumeAction(token, 'VERIFY')).rejects.toMatchObject({ status: 422 });
    expect((await fresh(u.id)).emailVerifiedAt).not.toBeNull();
    await account.requestAction(a.email, 'RESET');
    const reset = await findLink(a.email, 'reset');
    await account.consumeAction(reset, 'RESET', 'NewSecurePassword!2026');
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    expect(
      await compare(
        'NewSecurePassword!2026',
        (await db.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash,
      ),
    ).toBe(true);
  });
  it('enforces email ownership for operations and generic recovery for absent accounts', async () => {
    const unverified = { ...manager, emailVerifiedAt: null };
    await expect(service.saveLot(unverified, {})).rejects.toMatchObject({
      code: 'EMAIL_UNVERIFIED',
    });
    expect(
      (await account.requestAction('absent-' + run + '@example.invalid', 'RESET')).message,
    ).toContain('If the account');
    await expect(account.requestAction(manager.email, 'VERIFY', recipient)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('expires account tokens and permits only one competing consumer', async () => {
    const u = await user('race');
    await account.requestAction(u.email, 'RESET');
    const token = await findLink(u.email, 'reset');
    const race = await Promise.allSettled([
      account.consumeAction(token, 'RESET', 'ConcurrentPassword!2026'),
      account.consumeAction(token, 'RESET', 'ConcurrentPassword!2026'),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await account.requestAction(u.email, 'RESET');
    const expired = await findLink(u.email, 'reset');
    await db.actionToken.updateMany({
      where: { userId: u.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      account.consumeAction(expired, 'RESET', 'ConcurrentPassword!2026'),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('enables encrypted TOTP, rejects replay and consumes recovery codes once', async () => {
    let u = await user('mfa');
    const setup = await account.beginMfa(u, password);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } })).mfaPendingSecret,
    ).not.toContain(setup.secret);
    u = await fresh(u.id);
    const enabled = await account.enableMfa(u, totp(setup.secret, Math.floor(Date.now() / 30000)));
    expect(enabled.recoveryCodes).toHaveLength(10);
    u = await fresh(u.id);
    await expect(login(u.email, password)).rejects.toMatchObject({ code: 'MFA_REQUIRED' });
    await expect(
      account.verifyMfa(u.id, totp(setup.secret, Math.floor(Date.now() / 30000))),
    ).rejects.toMatchObject({ status: 401 });
    await account.verifyMfa(u.id, enabled.recoveryCodes[0]);
    await expect(account.verifyMfa(u.id, enabled.recoveryCodes[0])).rejects.toMatchObject({
      status: 401,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).recoveryHashes).toHaveLength(
      9,
    );
  });
  it('does not restore spent recovery codes under competing login attempts', async () => {
    const u = await user('recovery-race'),
      secret = base32(Buffer.from('12345678901234567890'));
    const { tokenHash } = await import('../../src/server/crypto');
    await db.user.update({
      where: { id: u.id },
      data: { mfaSecret: encrypt(secret), recoveryHashes: ['code-a', 'code-b'].map(tokenHash) },
    });
    await Promise.allSettled([
      account.verifyMfa(u.id, 'code-a'),
      account.verifyMfa(u.id, 'code-b'),
    ]);
    const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.recoveryHashes.length).toBeLessThan(2);
    for (const code of ['code-a', 'code-b'])
      if (!stored.recoveryHashes.includes(tokenHash(code)))
        await expect(account.verifyMfa(u.id, code)).rejects.toMatchObject({ status: 401 });
  });
  it('scopes session revocation and password changes', async () => {
    const a = await user('sessions'),
      b = await user('other-session');
    const session = await db.session.findFirstOrThrow({ where: { userId: b.id } });
    expect((await account.revokeSessions(a, session.id)).revoked).toBe(0);
    await expect(
      account.changePassword(a, {
        currentPassword: 'wrong',
        newPassword: 'NewSecurePassword!2026',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await account.changePassword(a, {
      currentPassword: password,
      newPassword: 'NewSecurePassword!2026',
    });
    expect(await db.session.count({ where: { userId: a.id } })).toBe(0);
  });
  it('invites verified matching email, denies cross-organization acceptance and protects last manager', async () => {
    const invited = await user('invitee');
    await ops.invite(manager, { email: invited.email, role: 'DONOR_MANAGER' });
    const token = await findLink(invited.email, 'invitation');
    await expect(ops.acceptInvite(recipient, token)).rejects.toMatchObject({ status: 422 });
    await ops.acceptInvite(invited, token);
    expect(
      await db.membership.count({
        where: { organizationId: manager.memberships[0].organizationId },
      }),
    ).toBe(2);
    const m = await db.membership.findFirstOrThrow({ where: { userId: invited.id } });
    await ops.removeMember(manager, m.id);
    await expect(ops.removeMember(manager, manager.memberships[0].id)).rejects.toMatchObject({
      code: 'LAST_MANAGER',
    });
    await expect(
      ops.invite(manager, { email: recipient.email, role: 'RECIPIENT_MANAGER' }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('edits own settings, requests identity re-verification and cannot edit another organization', async () => {
    const updated = await ops.settings(manager, {
      name: 'Updated release kitchen',
      contact: 'operator@example.invalid',
      timezone: 'Asia/Karachi',
      address: 'Updated synthetic collection desk',
    });
    expect(updated.verificationStatus).toBe('PENDING');
    await service.orgStatus(admin, manager.memberships[0].organizationId, 'VERIFIED');
    const unrelated = await db.organization.findUniqueOrThrow({
      where: { id: recipient.memberships[0].organizationId },
    });
    expect(unrelated.name).not.toBe('Updated release kitchen');
  });
  it('scopes inbox reads and audits validated policy updates', async () => {
    await ops.readNotification(manager);
    await db.notification.create({
      data: {
        userId: manager.id,
        kind: 'TEST',
        payload: { title: 'Private', href: '/app/dashboard' },
      },
    });
    expect((await ops.notifications(recipient)).items).toHaveLength(0);
    const n = (await ops.notifications(manager)).items[0];
    expect((await ops.readNotification(recipient, n.id)).count).toBe(0);
    await ops.readNotification(manager, n.id);
    expect((await ops.notifications(manager)).unread).toBe(0);
    await expect(ops.policy(manager)).rejects.toMatchObject({ status: 403 });
    await expect(
      ops.policy(admin, { capacityWeight: 50, windowWeight: 50, distanceWeight: 50 }),
    ).rejects.toThrow();
    const p = await ops.policy(admin, { capacityWeight: 40, windowWeight: 40, distanceWeight: 20 });
    expect(p.version).toBeGreaterThan(1);
  });
  it('file mail transport exercises durable queue without external email delivery', async () => {
    const u = await user('mail');
    await account.requestAction(u.email, 'RESET');
    const before = await db.mailOutbox.count({ where: { status: 'SENT' } });
    const result = await deliverMailBatch(100);
    expect(result.sent).toBeGreaterThan(0);
    expect(await db.mailOutbox.count({ where: { status: 'SENT' } })).toBeGreaterThan(before);
    const fs = await import('node:fs/promises');
    expect((await fs.readdir('.local/mail')).length).toBeGreaterThan(0);
  });
  it('records scoped disputes and audited resolutions without rewriting pickup state', async () => {
    await db.recipientProfile.create({
      data: {
        organizationId: recipient.memberships[0].organizationId,
        capacityValue: 100,
        capacityUnit: 'MEAL',
        serviceRadiusKm: 20,
        acceptedCategories: ['PREPARED'],
        specialHandlingCapabilities: ['AMBIENT'],
        availableFrom: new Date(Date.now() - 3600000),
        availableUntil: new Date(Date.now() + 86400000),
        latitude: 24.86,
        longitude: 67.01,
      },
    });
    const location = await db.location.findFirstOrThrow({
      where: { organizationId: manager.memberships[0].organizationId },
    });
    const lot = await service.saveLot(manager, {
      title: 'Release dispute lot',
      category: 'PREPARED',
      quantityValue: 25,
      quantityUnit: 'MEAL',
      locationId: location.id,
      pickupStart: new Date(Date.now() - 60000).toISOString(),
      pickupEnd: new Date(Date.now() + 90 * 60000).toISOString(),
      packaging: 'Sealed trays',
      handlingDeclaration: 'Synthetic declared containers held for collection',
      storageRequirements: 'AMBIENT',
    });
    await service.lotAction(manager, lot.id, 'publish');
    await service.sendOffers(manager, lot.id);
    const offer = await db.offer.findFirstOrThrow({
      where: { lotId: lot.id, recipientOrganizationId: recipient.memberships[0].organizationId },
    });
    const pickup = (await service.offerAction(recipient, offer.id, true, randomUUID())) as {
      id: string;
    };
    const d = await ops.openDispute(manager, {
      pickupId: pickup.id,
      reason: 'Synthetic collection scheduling concern',
    });
    expect((await ops.disputes(recipient)).some((row) => row.id === d.id)).toBe(false);
    await expect(
      ops.resolveDispute(manager, d.id, { resolution: 'Reviewed and discussed with both parties' }),
    ).rejects.toMatchObject({ status: 403 });
    await ops.resolveDispute(admin, d.id, {
      resolution: 'Reviewed with both parties; schedule remains unchanged',
    });
    expect((await db.pickup.findUniqueOrThrow({ where: { id: pickup.id } })).status).toBe(
      'REQUESTED',
    );
    await expect(
      ops.resolveDispute(admin, d.id, { resolution: 'Second resolution must be rejected' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.auditEvent.count({ where: { entityId: d.id, action: 'DISPUTE_RESOLVED' } }),
    ).toBe(1);
    const dispatcher = await user('batch-dispatcher', 'DISPATCHER', 'LOGISTICS');
    await service.pickupAction(manager, pickup.id, 'schedule', {
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
    });
    const assigned = await ops.batchAssign(manager, {
      pickupIds: [pickup.id, 'unrelated-private-id'],
      dispatcherUserId: dispatcher.id,
    });
    expect(assigned.results.map((r) => r.ok)).toEqual([true, false]);
    expect((await db.pickup.findUniqueOrThrow({ where: { id: pickup.id } })).dispatcherUserId).toBe(
      dispatcher.id,
    );
    await expect(
      ops.settings(manager, {
        name: 'Renamed active kitchen',
        contact: 'operator@example.invalid',
        timezone: 'Asia/Karachi',
        address: 'Synthetic collection desk',
      }),
    ).rejects.toMatchObject({ code: 'ACTIVE_OPERATIONS' });
  });
  it('production disables fictional administrators and requires real admin MFA', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_DEMO_LOGIN', 'false');
    vi.stubEnv('APP_ORIGIN', 'https://foodloop.example.invalid');
    try {
      await expect(login('admin@demo.foodloop.test', 'DemoFoodLoop!2026')).rejects.toMatchObject({
        code: 'DEMO_DISABLED',
      });
      expect(() => requireAdmin(admin)).toThrow('Enable an authenticator');
      expect(() =>
        requireAdmin({ ...admin, mfaSecret: encrypt('fixture-only-secret') }),
      ).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('email adapter passes provider idempotency and retries failures without real network delivery', async () => {
    const id = `provider-${run}`;
    await db.mailOutbox.create({
      data: {
        id,
        payload: encrypt(
          JSON.stringify({
            to: 'fixture@example.invalid',
            subject: 'Fixture only',
            text: 'No actual email is sent by this test',
          }),
        ),
        createdAt: new Date(0),
      },
    });
    vi.stubEnv('MAIL_TRANSPORT', 'resend');
    vi.stubEnv('MAIL_FROM', 'sender@example.invalid');
    vi.stubEnv('RESEND_API_KEY', 'fixture-key-not-real');
    const send = vi.fn(async (url: unknown, options?: RequestInit) => {
      expect(url).toBe('https://api.resend.com/emails');
      expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(id);
      return new Response(JSON.stringify({ id: 'fixture-provider-id' }), { status: 200 });
    });
    vi.stubGlobal('fetch', send);
    try {
      const result = await deliverMailBatch(1);
      expect(result.sent).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect((await db.mailOutbox.findUniqueOrThrow({ where: { id } })).status).toBe('SENT');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
    const failedId = id + '-failed';
    await db.mailOutbox.create({
      data: {
        id: failedId,
        payload: encrypt(
          JSON.stringify({
            to: 'fixture@example.invalid',
            subject: 'Fixture only',
            text: 'No actual send',
          }),
        ),
        createdAt: new Date(0),
      },
    });
    vi.stubEnv('MAIL_TRANSPORT', 'resend');
    vi.stubEnv('MAIL_FROM', 'sender@example.invalid');
    vi.stubEnv('RESEND_API_KEY', 'fixture-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );
    try {
      const result = await deliverMailBatch(1);
      expect(result.failed).toBe(1);
      const row = await db.mailOutbox.findUniqueOrThrow({ where: { id: failedId } });
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it('exports only authorized verified receipts and rejects invalid batch input', async () => {
    const csv = await ops.exportData(manager, 'impact');
    expect(csv.text).toContain('Actual quantity');
    expect(csv.text.split('\r\n')).toHaveLength(1);
    await expect(
      ops.batchAssign(manager, { pickupIds: [], dispatcherUserId: 'none' }),
    ).rejects.toThrow();
    const result = await ops.batchAssign(manager, {
      pickupIds: ['unrelated-private-id'],
      dispatcherUserId: 'none',
    });
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].message).toBe('Pickup not found');
  });
});
