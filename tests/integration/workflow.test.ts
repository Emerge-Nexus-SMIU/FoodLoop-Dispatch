import 'dotenv/config';
import { assertFixtureDatabase } from '../fixture-guard';
assertFixtureDatabase();
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { db } from '../../src/server/db';
import { currentUser, createSession, type Actor } from '../../src/server/auth';
import * as service from '../../src/server/service';
let donor: Actor,
  receiver: Actor,
  receiver2: Actor,
  dispatcher: Actor,
  admin: Actor,
  outsider: Actor;
const run = randomUUID().slice(0, 8);
const key = () => randomUUID();
async function actor(name: string, role?: string, type = 'RECIPIENT', verified = true) {
  const id = `test-${run}-${name}`;
  const u = await db.user.create({
    data: {
      id,
      email: `${id}@example.invalid`,
      passwordHash: await hash('TestPassword!2026', 4),
      emailVerifiedAt: new Date(),
      name,
      platformAdmin: name === 'admin',
    },
  });
  if (role) {
    const org = await db.organization.create({
      data: {
        id: `${id}-org`,
        name: `Test ${name}`,
        contact: 'test@example.invalid',
        type,
        verificationStatus: verified ? 'VERIFIED' : 'PENDING',
        locations: {
          create: {
            label: 'Desk',
            address: 'Fictional collection desk',
            latitude: 24.86,
            longitude: 67.01,
          },
        },
        memberships: { create: { userId: u.id, role } },
      },
    });
    if (type === 'RECIPIENT')
      await db.recipientProfile.create({
        data: {
          organizationId: org.id,
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
  }
  return (await currentUser(await createSession(u.id)))!;
}
async function draft(quantity = 25) {
  const location = await db.location.findFirstOrThrow({
    where: { organizationId: donor.memberships[0].organizationId },
  });
  return service.saveLot(donor, {
    title: `Integration ${run}`,
    category: 'PREPARED',
    quantityValue: quantity,
    quantityUnit: 'MEAL',
    locationId: location.id,
    pickupStart: new Date(Date.now() - 60000).toISOString(),
    pickupEnd: new Date(Date.now() + 90 * 60000).toISOString(),
    packaging: 'Sealed trays',
    handlingDeclaration: 'Declared sealed and held for collection by operator',
    storageRequirements: 'AMBIENT',
  });
}
async function published() {
  const l = await draft();
  await service.lotAction(donor, l.id, 'publish');
  await service.sendOffers(donor, l.id);
  return l;
}
async function reserve() {
  const l = await published();
  const o = await db.offer.findUniqueOrThrow({
    where: {
      lotId_recipientOrganizationId: {
        lotId: l.id,
        recipientOrganizationId: receiver.memberships[0].organizationId,
      },
    },
  });
  const p = await service.offerAction(receiver, o.id, true, key());
  return { l, p: p as { id: string } };
}
async function arrived() {
  const r = await reserve();
  await service.pickupAction(donor, r.p.id, 'schedule', {
    scheduledAt: new Date(Date.now() + 60000).toISOString(),
  });
  await service.pickupAction(donor, r.p.id, 'assign', { dispatcherUserId: dispatcher.id });
  await service.pickupAction(dispatcher, r.p.id, 'status', { status: 'EN_ROUTE' });
  await service.pickupAction(dispatcher, r.p.id, 'status', { status: 'ARRIVED' });
  return r;
}
beforeAll(async () => {
  donor = await actor('donor', 'DONOR_MANAGER', 'DONOR');
  receiver = await actor('receiver', 'RECIPIENT_MANAGER');
  receiver2 = await actor('receiver2', 'RECIPIENT_MANAGER');
  dispatcher = await actor('dispatcher', 'DISPATCHER', 'LOGISTICS');
  admin = await actor('admin');
  outsider = await actor('outsider', 'DONOR_MANAGER', 'DONOR');
});
afterAll(async () => db.$disconnect());
describe('PostgreSQL transactional workflow and isolation', () => {
  it('rejects handover before the collection window begins', async () => {
    const { p } = await arrived();
    await db.pickup.update({
      where: { id: p.id },
      data: { pickupStart: new Date(Date.now() + 30 * 60000) },
    });
    await expect(service.challenge(donor, p.id, { quantity: 25 })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('schedules only within recipient declared availability', async () => {
    const { p } = await reserve();
    const orgId = receiver.memberships[0].organizationId;
    await db.recipientProfile.update({
      where: { organizationId: orgId },
      data: { availableFrom: new Date(Date.now() + 30 * 60000) },
    });
    await expect(
      service.pickupAction(donor, p.id, 'schedule', {
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 422 });
    await db.recipientProfile.update({
      where: { organizationId: orgId },
      data: { availableFrom: new Date(Date.now() - 3600000) },
    });
  });
  it('hides pending offers when current eligibility is lost, including direct lot reads', async () => {
    const l = await published();
    const orgId = receiver.memberships[0].organizationId;
    await db.recipientProfile.update({
      where: { organizationId: orgId },
      data: { capacityValue: 10 },
    });
    expect((await service.listOffers(receiver)).some((o) => o.lotId === l.id)).toBe(false);
    await expect(service.getLot(receiver, l.id)).rejects.toMatchObject({ status: 404 });
    await db.recipientProfile.update({
      where: { organizationId: orgId },
      data: { capacityValue: 100 },
    });
  });
  it('exposes only sanitized recipient directory to donors', async () => {
    const rows = await service.recipientDirectory(donor);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).not.toHaveProperty('contact');
    await expect(service.recipientDirectory(receiver)).rejects.toMatchObject({ status: 403 });
  });
  it('blocks acceptance after donor suspension', async () => {
    const l = await published();
    const offer = await db.offer.findFirstOrThrow({
      where: { lotId: l.id, recipientOrganizationId: receiver.memberships[0].organizationId },
    });
    await service.orgStatus(admin, donor.memberships[0].organizationId, 'SUSPENDED');
    await expect(service.offerAction(receiver, offer.id, true, key())).rejects.toMatchObject({
      status: 409,
    });
    await service.orgStatus(admin, donor.memberships[0].organizationId, 'VERIFIED');
  });
  it('onboards an organization pending admin approval', async () => {
    const u = await actor('new');
    const o = await service.onboard(u, {
      name: 'Pending kitchen',
      type: 'DONOR',
      contact: 'demo@example.invalid',
      address: 'Fictional street 123',
    });
    expect(o.verificationStatus).toBe('PENDING');
    await expect(service.orgStatus(receiver, o.id, 'VERIFIED')).rejects.toMatchObject({
      status: 403,
    });
    await service.orgStatus(admin, o.id, 'VERIFIED');
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: o.id } })).verificationStatus,
    ).toBe('VERIFIED');
  });
  it('masks cross-tenant lots and denies vertical escalation', async () => {
    const l = await draft();
    await expect(service.getLot(outsider, l.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.lotAction(outsider, l.id, 'publish')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.saveLot(receiver, {})).rejects.toMatchObject({ status: 403 });
  });
  it('edits only drafts, publishes and records audits', async () => {
    const l = await draft();
    expect(l.status).toBe('DRAFT');
    await service.lotAction(donor, l.id, 'publish');
    await expect(service.lotAction(donor, l.id, 'publish')).rejects.toMatchObject({ status: 409 });
    const events = await db.auditEvent.findMany({ where: { entityId: l.id } });
    expect(events.map((e) => e.action)).toEqual(['LOT_CREATED', 'LOT_OPEN']);
  });
  it('evaluates eligibility and exclusions with persisted policy', async () => {
    const l = await published();
    const rows = await service.matches(donor, l.id, true);
    expect(
      rows.some(
        (r) => r.recipientOrganizationId === receiver.memberships[0].organizationId && r.eligible,
      ),
    ).toBe(true);
    const configured = await db.matchingPolicy.findUnique({ where: { id: 'active' } });
    expect(
      rows.every(
        (r) =>
          r.policyVersion ===
          (configured && configured.version > 1
            ? `rules-v1.0+policy-${configured.version}`
            : 'rules-v1.0'),
      ),
    ).toBe(true);
  });
  it('accepts one winner under simultaneous competing requests', async () => {
    const l = await published();
    const offers = await db.offer.findMany({
      where: {
        lotId: l.id,
        recipientOrganizationId: {
          in: [receiver.memberships[0].organizationId, receiver2.memberships[0].organizationId],
        },
      },
    });
    const result = await Promise.allSettled(
      offers.map((o) =>
        service.offerAction(
          o.recipientOrganizationId === receiver.memberships[0].organizationId
            ? receiver
            : receiver2,
          o.id,
          true,
          key(),
        ),
      ),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    expect(await db.pickup.count({ where: { lotId: l.id } })).toBe(1);
    expect(await db.offer.count({ where: { lotId: l.id, status: 'ACCEPTED' } })).toBe(1);
  });
  it('replays an identical acceptance key without duplicate pickup', async () => {
    const l = await published();
    const o = await db.offer.findUniqueOrThrow({
      where: {
        lotId_recipientOrganizationId: {
          lotId: l.id,
          recipientOrganizationId: receiver.memberships[0].organizationId,
        },
      },
    });
    const k = key();
    const first = await service.offerAction(receiver, o.id, true, k);
    expect(await service.offerAction(receiver, o.id, true, k)).toEqual(first);
  });
  it('rejects expired and suspended recipient acceptance', async () => {
    const l = await published();
    const o = await db.offer.findUniqueOrThrow({
      where: {
        lotId_recipientOrganizationId: {
          lotId: l.id,
          recipientOrganizationId: receiver.memberships[0].organizationId,
        },
      },
    });
    await db.lot.update({ where: { id: l.id }, data: { pickupEnd: new Date(Date.now() - 1000) } });
    await expect(service.offerAction(receiver, o.id, true, key())).rejects.toMatchObject({
      status: 409,
    });
    const pending = {
      ...receiver,
      memberships: receiver.memberships.map((m) => ({
        ...m,
        organization: { ...m.organization, verificationStatus: 'SUSPENDED' },
      })),
    };
    await expect(service.offerAction(pending, o.id, true, key())).rejects.toMatchObject({
      status: 403,
    });
    await service.reconcile();
    expect((await db.lot.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('EXPIRED');
  });
  it('enforces dispatch state order and assigned access', async () => {
    const { p } = await reserve();
    await expect(
      service.pickupAction(dispatcher, p.id, 'status', { status: 'ARRIVED' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.getPickup(receiver2, p.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.challenge(donor, p.id, { quantity: 25 })).rejects.toMatchObject({
      status: 409,
    });
  });
  it('completes two-party handover, consumes OTP once and counts only actual units', async () => {
    const before = await service.impact(donor);
    const { p } = await arrived();
    const proof = await service.challenge(donor, p.id, { quantity: 25 });
    const stored = await db.handover.findUniqueOrThrow({ where: { pickupId: p.id } });
    expect(stored.codeHash).not.toContain(proof.code);
    await expect(
      service.verifyCode(donor, p.id, { code: proof.code }, key()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.verifyCode(
        receiver,
        p.id,
        { code: proof.code === '111111' ? '222222' : '111111' },
        key(),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      await db.handoverAttempt.count({ where: { handoverId: stored.id, successful: false } }),
    ).toBe(1);
    await service.verifyCode(receiver, p.id, { code: proof.code }, key());
    expect((await service.impact(donor)).verifiedMeals).toBe(before.verifiedMeals);
    await expect(
      service.verifyCode(receiver, p.id, { code: proof.code }, key()),
    ).rejects.toMatchObject({ status: 409 });
    const k = key();
    await service.confirm(donor, p.id, k);
    await service.confirm(donor, p.id, k);
    const after = await service.impact(donor);
    expect(after.verifiedMeals - before.verifiedMeals).toBe(25);
    expect(after.verifiedKgDiverted - before.verifiedKgDiverted).toBe(0);
    expect((await service.receipt(receiver, p.id)).handover?.status).toBe('VERIFIED');
    expect(
      await db.auditEvent.count({ where: { entityId: stored.id, action: 'HANDOVER_VERIFIED' } }),
    ).toBe(1);
  });
  it('rejects expired challenge and excessive or unexplained partial quantity', async () => {
    const { p } = await arrived();
    await expect(service.challenge(donor, p.id, { quantity: 26 })).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.challenge(donor, p.id, { quantity: 20 })).rejects.toMatchObject({
      status: 422,
    });
    const proof = await service.challenge(donor, p.id, {
      quantity: 20,
      discrepancyReason: 'Five packages withheld by donor',
    });
    await db.handover.update({
      where: { pickupId: p.id },
      data: { codeExpiresAt: new Date(Date.now() - 1) },
    });
    await expect(
      service.verifyCode(receiver, p.id, { code: proof.code }, key()),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('logs failed attempts and locks after five bad codes', async () => {
    const { p } = await arrived();
    const proof = await service.challenge(donor, p.id, { quantity: 25 });
    for (let i = 0; i < 5; i++)
      await expect(
        service.verifyCode(
          receiver,
          p.id,
          { code: proof.code === '111111' ? '222222' : '111111' },
          key(),
        ),
      ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.verifyCode(receiver, p.id, { code: proof.code }, key()),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('canceled/failed pickups never change impact', async () => {
    const before = await service.impact(donor);
    const { p } = await reserve();
    await service.pickupAction(donor, p.id, 'status', {
      status: 'FAILED',
      reason: 'Collection vehicle unavailable',
    });
    expect((await service.impact(donor)).verifiedMeals).toBe(before.verifiedMeals);
    await expect(service.receipt(donor, p.id)).rejects.toMatchObject({ status: 409 });
  });
  it('partial receipt aggregates only actual quantity and separately verified weight', async () => {
    const { p } = await arrived();
    const before = await service.impact(donor);
    const proof = await service.challenge(donor, p.id, {
      quantity: 20,
      weightKg: 8.5,
      discrepancyReason: 'Five containers withheld',
    });
    await service.verifyCode(dispatcher, p.id, { code: proof.code }, key());
    await service.confirm(donor, p.id, key());
    const after = await service.impact(donor);
    expect(after.verifiedMeals - before.verifiedMeals).toBe(20);
    expect(after.verifiedKgDiverted - before.verifiedKgDiverted).toBe(8.5);
  });
  it('database prevents audit mutation and verified receipt changes', async () => {
    const event = await db.auditEvent.findFirstOrThrow({ where: { actorId: donor.id } });
    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { action: 'TAMPER' } }),
    ).rejects.toThrow();
    const h = await db.handover.findFirstOrThrow({
      where: { donorActorId: donor.id, status: 'VERIFIED' },
    });
    await expect(
      db.handover.update({ where: { id: h.id }, data: { verifiedQuantityValue: 999 } }),
    ).rejects.toThrow();
  });
  it('assistant uses authorized persisted facts and requires no external key', async () => {
    const result = await service.explain(outsider);
    expect(result.mode).toBe('DETERMINISTIC');
    expect(result.citations).toHaveLength(0);
    expect(result.summary).toContain('0 visible open lots');
  });
});
