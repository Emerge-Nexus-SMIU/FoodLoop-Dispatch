import { notify } from './notifications';
import { Prisma } from '@prisma/client';
import { randomUUID, randomInt, timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { type Actor, requireRole, requireAdmin, rateLimit } from './auth';
import { ensure, AppError } from './errors';
import { lotSchema, orgSchema, profileSchema, challengeSchema } from './schemas';
import { evaluate, DEFAULT_WEIGHTS } from './matching';
import { z } from 'zod';
type Tx = Prisma.TransactionClient;
const terminal = ['COMPLETED', 'CANCELED', 'FAILED'];
const lotInclude = {
  location: true,
  donor: { select: { id: true, name: true, timezone: true, demo: true, verificationStatus: true } },
} satisfies Prisma.LotInclude;
const pickupInclude = {
  lot: { include: lotInclude },
  recipient: {
    select: { id: true, name: true, timezone: true, demo: true, verificationStatus: true },
  },
  handover: {
    select: {
      id: true,
      status: true,
      codeExpiresAt: true,
      receiverConfirmedAt: true,
      verifiedAt: true,
      verifiedQuantityValue: true,
      verifiedQuantityUnit: true,
      verifiedWeightKg: true,
      receiptReference: true,
      discrepancyReason: true,
    },
  },
} satisfies Prisma.PickupInclude;
export async function transaction<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034' && i < 4)
        continue;
      throw e;
    }
  }
}
async function audit(
  t: Tx,
  a: Actor | null,
  org: string | null,
  type: string,
  id: string,
  action: string,
  oldState?: string,
  newState?: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await t.auditEvent.create({
    data: {
      actorId: a?.id,
      organizationId: org,
      entityType: type,
      entityId: id,
      action,
      oldState,
      newState,
      metadata,
      correlationId: randomUUID(),
    },
  });
}
export async function reconcile() {
  await transaction(async (t) => {
    const lock = await t.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(783534014) AS locked`;
    if (!lock[0].locked) return;
    const now = new Date();
    const lots = await t.lot.findMany({
      where: {
        status: { in: ['OPEN', 'RESERVED', 'PICKUP_IN_PROGRESS'] },
        pickupEnd: { lte: now },
      },
      take: 100,
      orderBy: { pickupEnd: 'asc' },
    });
    for (const l of lots) {
      await t.lot.update({
        where: { id: l.id },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      await t.offer.updateMany({
        where: { lotId: l.id, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'EXPIRED' },
      });
      await t.pickup.updateMany({
        where: { lotId: l.id, status: { notIn: terminal } },
        data: { status: 'FAILED', failureReason: 'Pickup window expired' },
      });
      await audit(t, null, l.donorOrganizationId, 'Lot', l.id, 'LOT_EXPIRED', l.status, 'EXPIRED');
    }
  });
}
function pickupScope(a: Actor): Prisma.PickupWhereInput {
  return a.platformAdmin
    ? {}
    : {
        OR: [
          {
            lot: {
              donorOrganizationId: {
                in: a.memberships
                  .filter((m) => m.role === 'DONOR_MANAGER')
                  .map((m) => m.organizationId),
              },
            },
          },
          {
            recipientOrganizationId: {
              in: a.memberships
                .filter((m) => m.role === 'RECIPIENT_MANAGER')
                .map((m) => m.organizationId),
            },
          },
          { dispatcherUserId: a.id },
        ],
      };
}
async function scopedPickup(t: Tx, a: Actor, id: string) {
  const p = await t.pickup.findFirst({
    where: { id, ...pickupScope(a) },
    include: { lot: { include: lotInclude }, recipient: true, handover: true },
  });
  ensure(p, 404, 'NOT_FOUND', 'Pickup not found');
  return p;
}
async function ownLot(t: Tx, a: Actor, id: string) {
  const m = requireRole(a, 'DONOR_MANAGER');
  const l = await t.lot.findFirst({
    where: { id, donorOrganizationId: m.organizationId },
    include: lotInclude,
  });
  ensure(l, 404, 'NOT_FOUND', 'Lot not found');
  if (
    !a.platformAdmin &&
    !a.memberships.some(
      (m) => m.role === 'DONOR_MANAGER' && m.organizationId === l.donorOrganizationId,
    )
  ) {
    const ids = a.memberships
      .filter((m) => m.role === 'RECIPIENT_MANAGER')
      .map((m) => m.organizationId);
    const offers = await db.offer.findMany({
      where: {
        lotId: id,
        recipientOrganizationId: { in: ids },
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
    });
    const recipients = await db.organization.findMany({
      where: { id: { in: ids } },
      include: { profile: true },
    });
    ensure(
      offers.some(
        (o) =>
          o.status === 'ACCEPTED' ||
          (l.status === 'OPEN' &&
            l.donor.verificationStatus === 'VERIFIED' &&
            recipients.some((r) => r.id === o.recipientOrganizationId && evaluate(l, r).eligible)),
      ),
      404,
      'NOT_FOUND',
      'Lot not found',
    );
  }
  return l;
}
function verified(a: Actor, role: string) {
  const m = requireRole(a, role);
  ensure(
    m.organization.verificationStatus === 'VERIFIED',
    403,
    'ORG_UNVERIFIED',
    'Organization must be verified',
  );
  return m;
}
async function idempotent(t: Tx, a: Actor, key: string | undefined, op: string, resource: string) {
  ensure(
    key && key.length >= 8 && key.length <= 120,
    422,
    'IDEMPOTENCY_REQUIRED',
    'A unique Idempotency-Key header is required',
  );
  const old = await t.idempotency.findUnique({ where: { actorId_key: { actorId: a.id, key } } });
  if (old) {
    ensure(
      old.operation === op && old.resourceId === resource,
      409,
      'KEY_REUSED',
      'Idempotency key belongs to a different action',
    );
    return true;
  }
  await t.idempotency.create({ data: { actorId: a.id, key, operation: op, resourceId: resource } });
  return false;
}
export async function organizations(a: Actor, skip = 0, status?: string) {
  return db.organization.findMany({
    where: a.platformAdmin
      ? status
        ? { verificationStatus: status }
        : {}
      : { id: { in: a.memberships.map((m) => m.organizationId) } },
    include: { locations: true, profile: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip,
    take: 50,
  });
}
export async function onboard(a: Actor, input: unknown) {
  ensure(!a.memberships.length, 409, 'ALREADY_ONBOARDED', 'Organization already created');
  const v = orgSchema.parse(input);
  return transaction(async (t) => {
    ensure(
      (await t.membership.count({ where: { userId: a.id } })) === 0,
      409,
      'ALREADY_ONBOARDED',
      'Organization already created',
    );
    const o = await t.organization.create({
      data: {
        name: v.name,
        type: v.type,
        contact: v.contact,
        timezone: v.timezone,
        locations: {
          create: {
            label: 'Collection point',
            address: v.address,
            latitude: v.latitude,
            longitude: v.longitude,
          },
        },
        memberships: {
          create: {
            userId: a.id,
            role:
              v.type === 'DONOR'
                ? 'DONOR_MANAGER'
                : v.type === 'RECIPIENT'
                  ? 'RECIPIENT_MANAGER'
                  : 'DISPATCHER',
          },
        },
      },
    });
    await audit(t, a, o.id, 'Organization', o.id, 'ORGANIZATION_CREATED', undefined, 'PENDING');
    return o;
  });
}
export async function orgStatus(a: Actor, id: string, status: 'VERIFIED' | 'SUSPENDED') {
  requireAdmin(a);
  return transaction(async (t) => {
    const old = await t.organization.findUnique({ where: { id } });
    ensure(old, 404, 'NOT_FOUND', 'Organization not found');
    const o = await t.organization.update({ where: { id }, data: { verificationStatus: status } });
    await audit(
      t,
      a,
      id,
      'Organization',
      id,
      `ORGANIZATION_${status}`,
      old.verificationStatus,
      status,
    );
    await notify(t, [id], 'ORGANIZATION_STATUS', `Organization status: ${status}`, '/app/settings');
    return o;
  });
}
export async function updateProfile(a: Actor, input: unknown) {
  const m = requireRole(a, 'RECIPIENT_MANAGER'),
    v = profileSchema.parse(input);
  return transaction(async (t) => {
    const p = await t.recipientProfile.upsert({
      where: { organizationId: m.organizationId },
      create: {
        ...v,
        availableFrom: new Date(v.availableFrom),
        availableUntil: new Date(v.availableUntil),
        organizationId: m.organizationId,
      },
      update: {
        ...v,
        availableFrom: new Date(v.availableFrom),
        availableUntil: new Date(v.availableUntil),
      },
    });
    await audit(t, a, m.organizationId, 'RecipientProfile', p.id, 'PROFILE_UPDATED');
    return p;
  });
}
export async function listLots(a: Actor, skip = 0) {
  if (!a.platformAdmin && !a.memberships.some((m) => m.role === 'DONOR_MANAGER'))
    return (await listOffers(a, skip)).map((o) => o.lot);
  const donor = a.memberships.find((m) => m.role === 'DONOR_MANAGER');
  return db.lot.findMany({
    where: a.platformAdmin
      ? {}
      : donor
        ? { donorOrganizationId: donor.organizationId }
        : {
            offers: {
              some: {
                recipientOrganizationId: {
                  in: a.memberships
                    .filter((m) => m.role === 'RECIPIENT_MANAGER')
                    .map((m) => m.organizationId),
                },
                status: { in: ['PENDING', 'ACCEPTED'] },
              },
            },
          },
    include: lotInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip,
    take: 50,
  });
}
export async function getLot(a: Actor, id: string) {
  const l = await db.lot.findFirst({
    where: {
      id,
      ...(a.platformAdmin
        ? {}
        : {
            OR: [
              {
                donorOrganizationId: {
                  in: a.memberships
                    .filter((m) => m.role === 'DONOR_MANAGER')
                    .map((m) => m.organizationId),
                },
              },
              {
                offers: {
                  some: {
                    recipientOrganizationId: {
                      in: a.memberships
                        .filter((m) => m.role === 'RECIPIENT_MANAGER')
                        .map((m) => m.organizationId),
                    },
                  },
                },
              },
            ],
          }),
    },
    include: lotInclude,
  });
  ensure(l, 404, 'NOT_FOUND', 'Lot not found');
  if (
    !a.platformAdmin &&
    !a.memberships.some(
      (m) => m.role === 'DONOR_MANAGER' && m.organizationId === l.donorOrganizationId,
    )
  ) {
    const ids = a.memberships
      .filter((m) => m.role === 'RECIPIENT_MANAGER')
      .map((m) => m.organizationId);
    const offers = await db.offer.findMany({
      where: {
        lotId: id,
        recipientOrganizationId: { in: ids },
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
    });
    const recipients = await db.organization.findMany({
      where: { id: { in: ids } },
      include: { profile: true },
    });
    ensure(
      offers.some(
        (o) =>
          o.status === 'ACCEPTED' ||
          (l.status === 'OPEN' &&
            l.donor.verificationStatus === 'VERIFIED' &&
            recipients.some((r) => r.id === o.recipientOrganizationId && evaluate(l, r).eligible)),
      ),
      404,
      'NOT_FOUND',
      'Lot not found',
    );
  }
  return l;
}
export async function saveLot(a: Actor, input: unknown, id?: string) {
  const m = verified(a, 'DONOR_MANAGER'),
    v = lotSchema.parse(input);
  ensure(
    new Date(v.pickupEnd) > new Date(),
    422,
    'WINDOW_EXPIRED',
    'Pickup window must be in the future',
  );
  return transaction(async (t) => {
    const location = await t.location.findFirst({
      where: { id: v.locationId, organizationId: m.organizationId },
    });
    ensure(location, 422, 'LOCATION_INVALID', 'Choose your own collection location');
    if (id) {
      const old = await ownLot(t, a, id);
      ensure(
        old.status === 'DRAFT',
        409,
        'STATE_CONFLICT',
        'Only drafts can be edited; cancel and create a fresh lot after publication',
      );
    }
    const data = { ...v, pickupStart: new Date(v.pickupStart), pickupEnd: new Date(v.pickupEnd) };
    const l = id
      ? await t.lot.update({ where: { id }, data: { ...data, version: { increment: 1 } } })
      : await t.lot.create({
          data: { ...data, createdById: a.id, donorOrganizationId: m.organizationId },
        });
    await audit(
      t,
      a,
      m.organizationId,
      'Lot',
      l.id,
      id ? 'LOT_UPDATED' : 'LOT_CREATED',
      undefined,
      l.status,
    );
    return l;
  });
}
export async function lotAction(a: Actor, id: string, action: 'publish' | 'cancel') {
  verified(a, 'DONOR_MANAGER');
  return transaction(async (t) => {
    const l = await ownLot(t, a, id);
    if (action === 'publish') {
      ensure(
        l.status === 'DRAFT' && l.pickupEnd > new Date(),
        409,
        'STATE_CONFLICT',
        'Only a non-expired draft can be published',
      );
    } else {
      ensure(
        ['DRAFT', 'OPEN', 'RESERVED'].includes(l.status),
        409,
        'STATE_CONFLICT',
        'Lot cannot be canceled at this stage',
      );
      await t.offer.updateMany({
        where: { lotId: id, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { status: 'SUPERSEDED' },
      });
      await t.pickup.updateMany({
        where: { lotId: id },
        data: { status: 'CANCELED', failureReason: 'Donor canceled lot' },
      });
    }
    const status = action === 'publish' ? 'OPEN' : 'CANCELED';
    const result = await t.lot.update({
      where: { id },
      data: { status, version: { increment: 1 } },
    });
    await audit(t, a, l.donorOrganizationId, 'Lot', id, `LOT_${status}`, l.status, status);
    return result;
  });
}
export async function matches(a: Actor, id: string, refresh = false) {
  await rateLimit(`matches:${a.id}`, 60);
  return transaction(async (t) => {
    const l = await ownLot(t, a, id);
    ensure(
      ['OPEN', 'DRAFT'].includes(l.status),
      409,
      'STATE_CONFLICT',
      'Matching requires an open lot or draft',
    );
    if (refresh) {
      const activePolicy =
        (await t.matchingPolicy.findUnique({ where: { id: 'active' } })) ?? DEFAULT_WEIGHTS;
      const recipients = await t.organization.findMany({
        where: { type: 'RECIPIENT' },
        include: { profile: true },
      });
      for (const r of recipients) {
        const e = evaluate(l, r, new Date(), activePolicy);
        await t.eligibilityEvaluation.create({
          data: {
            lotId: id,
            recipientOrganizationId: r.id,
            eligible: e.eligible,
            reasonCodes: e.reasonCodes,
            scoreBreakdown: e.factors,
            matchScore: e.score,
            distanceKm: e.distanceKm,
            policyVersion: e.policyVersion,
          },
        });
      }
      await audit(t, a, l.donorOrganizationId, 'Lot', id, 'MATCHES_EVALUATED');
    }
    const rows = await t.eligibilityEvaluation.findMany({
      where: { lotId: id },
      orderBy: { evaluatedAt: 'desc' },
      distinct: ['recipientOrganizationId'],
    });
    const names = await t.organization.findMany({
      where: { id: { in: rows.map((r) => r.recipientOrganizationId) } },
      select: { id: true, name: true },
    });
    return rows
      .map((r) => ({
        ...r,
        recipientName: names.find((n) => n.id === r.recipientOrganizationId)?.name,
      }))
      .sort((x, y) => (y.matchScore ?? -1) - (x.matchScore ?? -1));
  });
}
export async function sendOffers(a: Actor, id: string) {
  verified(a, 'DONOR_MANAGER');
  return transaction(async (t) => {
    const l = await ownLot(t, a, id);
    ensure(
      l.status === 'OPEN' && l.pickupEnd > new Date(),
      409,
      'STATE_CONFLICT',
      'Lot is not accepting offers',
    );
    const recipients = await t.organization.findMany({
      where: { type: 'RECIPIENT' },
      include: { profile: true },
    });
    let count = 0;
    for (const r of recipients) {
      const e = evaluate(l, r);
      if (!e.eligible) continue;
      await t.offer.upsert({
        where: { lotId_recipientOrganizationId: { lotId: id, recipientOrganizationId: r.id } },
        create: { lotId: id, recipientOrganizationId: r.id, expiresAt: l.pickupEnd },
        update: {},
      });
      await notify(t, [r.id], 'OFFER_AVAILABLE', `New surplus offer: ${l.title}`, '/app/offers');
      count++;
    }
    await audit(t, a, l.donorOrganizationId, 'Lot', id, 'OFFERS_SENT', undefined, undefined, {
      count,
    });
    return { count };
  });
}
export async function listOffers(a: Actor, skip = 0) {
  const ids = a.memberships
    .filter((m) => m.role === 'RECIPIENT_MANAGER')
    .map((m) => m.organizationId);
  const rows = await db.offer.findMany({
    where: a.platformAdmin
      ? {}
      : { recipientOrganizationId: { in: ids }, status: { in: ['PENDING', 'ACCEPTED'] } },
    include: { lot: { include: lotInclude } },
    orderBy: [{ sentAt: 'desc' }, { id: 'asc' }],
    skip,
    take: 50,
  });
  if (a.platformAdmin) return rows;
  const recipients = await db.organization.findMany({
    where: { id: { in: ids } },
    include: { profile: true },
  });
  return rows.filter(
    (o) =>
      o.status === 'ACCEPTED' ||
      (o.status === 'PENDING' &&
        o.lot.status === 'OPEN' &&
        o.lot.donor.verificationStatus === 'VERIFIED' &&
        recipients.some((r) => r.id === o.recipientOrganizationId && evaluate(o.lot, r).eligible)),
  );
}
export async function recipientDirectory(a: Actor) {
  requireRole(a, 'DONOR_MANAGER');
  return db.organization.findMany({
    where: { type: 'RECIPIENT' },
    select: {
      id: true,
      name: true,
      verificationStatus: true,
      profile: {
        select: {
          capacityValue: true,
          capacityUnit: true,
          acceptedCategories: true,
          specialHandlingCapabilities: true,
          serviceRadiusKm: true,
          availableFrom: true,
          availableUntil: true,
        },
      },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 100,
  });
}

export async function offerAction(a: Actor, id: string, accept: boolean, key?: string) {
  const m = verified(a, 'RECIPIENT_MANAGER');
  await rateLimit(`accept:${a.id}`, 40);
  return transaction(async (t) => {
    const o = await t.offer.findFirst({
      where: { id, recipientOrganizationId: m.organizationId },
      include: { lot: { include: lotInclude } },
    });
    ensure(o, 404, 'NOT_FOUND', 'Offer not found');
    if (accept && (await idempotent(t, a, key, 'accept', id))) {
      const p = await t.pickup.findUnique({ where: { lotId: o.lotId } });
      ensure(
        p?.recipientOrganizationId === m.organizationId,
        409,
        'STATE_CONFLICT',
        'Reservation no longer available',
      );
      return p;
    }
    ensure(
      o.status === 'PENDING' && o.expiresAt > new Date(),
      409,
      'OFFER_UNAVAILABLE',
      'Offer has expired or was already processed',
    );
    if (!accept) {
      await t.offer.update({ where: { id }, data: { status: 'DECLINED' } });
      await audit(t, a, m.organizationId, 'Offer', id, 'OFFER_DECLINED', 'PENDING', 'DECLINED');
      return { status: 'DECLINED' };
    }
    const recipient = await t.organization.findUniqueOrThrow({
      where: { id: m.organizationId },
      include: { profile: true },
    });
    ensure(
      o.lot.donor.verificationStatus === 'VERIFIED',
      409,
      'DONOR_UNVERIFIED',
      'Donating organization is not currently verified',
    );
    ensure(
      evaluate(o.lot, recipient).eligible,
      409,
      'NOT_ELIGIBLE',
      'Your receiving profile no longer meets this lot’s requirements',
    );
    const won = await t.lot.updateMany({
      where: { id: o.lotId, status: 'OPEN', pickupEnd: { gt: new Date() } },
      data: { status: 'RESERVED', version: { increment: 1 } },
    });
    ensure(won.count === 1, 409, 'ALREADY_RESERVED', 'Another recipient has reserved this lot');
    await t.offer.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    await t.offer.updateMany({
      where: { lotId: o.lotId, id: { not: id }, status: 'PENDING' },
      data: { status: 'SUPERSEDED' },
    });
    const p = await t.pickup.create({
      data: {
        lotId: o.lotId,
        recipientOrganizationId: m.organizationId,
        pickupStart: o.lot.pickupStart,
        pickupEnd: o.lot.pickupEnd,
      },
    });
    await audit(
      t,
      a,
      o.lot.donorOrganizationId,
      'Lot',
      o.lotId,
      'LOT_RESERVED',
      'OPEN',
      'RESERVED',
      { recipientOrganizationId: m.organizationId, pickupId: p.id },
    );
    await audit(t, a, m.organizationId, 'Offer', id, 'OFFER_ACCEPTED', 'PENDING', 'ACCEPTED');
    await notify(
      t,
      [o.lot.donorOrganizationId],
      'LOT_RESERVED',
      `Reserved: ${o.lot.title}`,
      '/app/pickups',
    );
    return p;
  });
}
export async function listPickups(a: Actor, skip = 0, verifiedOnly = false) {
  return db.pickup.findMany({
    where: { ...pickupScope(a), ...(verifiedOnly ? { handover: { status: 'VERIFIED' } } : {}) },
    include: pickupInclude,
    orderBy: [{ pickupEnd: 'asc' }, { id: 'asc' }],
    skip,
    take: 50,
  });
}
export async function getPickup(a: Actor, id: string) {
  const p = await db.pickup.findFirst({ where: { id, ...pickupScope(a) }, include: pickupInclude });
  ensure(p, 404, 'NOT_FOUND', 'Pickup not found');
  return p;
}
export async function dispatchers(a: Actor) {
  requireRole(a, 'DONOR_MANAGER');
  return db.user.findMany({
    where: {
      active: true,
      memberships: {
        some: { role: 'DISPATCHER', organization: { verificationStatus: 'VERIFIED' } },
      },
    },
    select: { id: true, name: true },
    take: 100,
  });
}
export async function pickupAction(a: Actor, id: string, action: string, input: unknown) {
  return transaction(async (t) => {
    const p = await scopedPickup(t, a, id);
    const donor = a.memberships.some(
      (m) =>
        m.role === 'DONOR_MANAGER' &&
        m.organizationId === p.lot.donorOrganizationId &&
        m.organization.verificationStatus === 'VERIFIED',
    );
    ensure(
      p.lot.donor.verificationStatus === 'VERIFIED' &&
        p.recipient.verificationStatus === 'VERIFIED',
      409,
      'PARTNER_UNVERIFIED',
      'Both organizations must remain verified',
    );
    ensure(
      p.pickupEnd > new Date() && !terminal.includes(p.status),
      409,
      'STATE_CONFLICT',
      'Pickup is expired or closed',
    );
    let data: Prisma.PickupUncheckedUpdateInput;
    if (action === 'schedule') {
      ensure(donor, 403, 'FORBIDDEN', 'Only the donor can schedule collection');
      const v = z.object({ scheduledAt: z.iso.datetime() }).parse(input);
      const at = new Date(v.scheduledAt);
      ensure(
        ['REQUESTED', 'SCHEDULED'].includes(p.status) &&
          at >= p.pickupStart &&
          at < p.pickupEnd &&
          at >= new Date(Date.now() - 60000),
        422,
        'INVALID_SCHEDULE',
        'Choose a future time inside the pickup window',
      );
      const profile = await t.recipientProfile.findUnique({
        where: { organizationId: p.recipientOrganizationId },
      });
      ensure(
        profile && at >= profile.availableFrom && at < profile.availableUntil,
        422,
        'OUTSIDE_AVAILABILITY',
        'Schedule inside the recipient’s declared availability',
      );
      data = { scheduledAt: at, status: 'SCHEDULED' };
    } else if (action === 'assign') {
      ensure(donor, 403, 'FORBIDDEN', 'Only the donor can assign a dispatcher');
      ensure(
        ['SCHEDULED', 'ASSIGNED'].includes(p.status),
        409,
        'STATE_CONFLICT',
        'Schedule pickup before assignment',
      );
      const v = z.object({ dispatcherUserId: z.string() }).parse(input);
      const user = await t.user.findFirst({
        where: {
          id: v.dispatcherUserId,
          active: true,
          memberships: {
            some: { role: 'DISPATCHER', organization: { verificationStatus: 'VERIFIED' } },
          },
        },
      });
      ensure(user, 422, 'INVALID_DISPATCHER', 'Choose a verified dispatcher');
      data = { dispatcherUserId: user.id, status: 'ASSIGNED' };
    } else {
      const v = z
        .object({
          status: z.enum(['EN_ROUTE', 'ARRIVED', 'FAILED', 'CANCELED']),
          reason: z.string().max(500).optional(),
        })
        .parse(input);
      const assigned =
        p.dispatcherUserId === a.id &&
        a.memberships.some(
          (m) => m.role === 'DISPATCHER' && m.organization.verificationStatus === 'VERIFIED',
        );
      ensure(
        assigned || (donor && ['FAILED', 'CANCELED'].includes(v.status)),
        403,
        'FORBIDDEN',
        'Assigned dispatcher required',
      );
      if (['FAILED', 'CANCELED'].includes(v.status)) {
        ensure(v.reason && v.reason.trim().length >= 5, 422, 'REASON_REQUIRED', 'Provide a reason');
        data = { status: v.status, failureReason: v.reason };
        await t.lot.update({
          where: { id: p.lotId },
          data: { status: 'CANCELED', version: { increment: 1 } },
        });
      } else {
        ensure(
          (p.status === 'ASSIGNED' && v.status === 'EN_ROUTE') ||
            (p.status === 'EN_ROUTE' && v.status === 'ARRIVED'),
          409,
          'STATE_CONFLICT',
          'Follow assigned → en route → arrived',
        );
        data = { status: v.status, ...(v.status === 'ARRIVED' ? { arrivedAt: new Date() } : {}) };
        await t.lot.update({
          where: { id: p.lotId },
          data: { status: 'PICKUP_IN_PROGRESS', version: { increment: 1 } },
        });
      }
    }
    const result = await t.pickup.update({ where: { id }, data });
    await audit(
      t,
      a,
      p.lot.donorOrganizationId,
      'Pickup',
      id,
      `PICKUP_${result.status}`,
      p.status,
      result.status,
    );
    await notify(
      t,
      [p.lot.donorOrganizationId, p.recipientOrganizationId],
      'PICKUP_STATUS',
      `Pickup ${result.status.toLowerCase().replaceAll('_', ' ')}: ${p.lot.title}`,
      '/app/pickups',
      result.dispatcherUserId ? [result.dispatcherUserId] : [],
    );
    return result;
  });
}
function digest(salt: string, code: string) {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
export async function challenge(a: Actor, id: string, input: unknown) {
  verified(a, 'DONOR_MANAGER');
  await rateLimit(`challenge:${a.id}:${id}`, 5, 600);
  const v = challengeSchema.parse(input);
  return transaction(async (t) => {
    const p = await scopedPickup(t, a, id);
    ensure(
      a.memberships.some(
        (m) => m.role === 'DONOR_MANAGER' && m.organizationId === p.lot.donorOrganizationId,
      ),
      403,
      'FORBIDDEN',
      'Only the donating organization can issue proof',
    );
    ensure(
      p.status === 'ARRIVED' &&
        p.pickupStart <= new Date() &&
        p.pickupEnd > new Date() &&
        (!p.handover || (p.handover.status === 'PENDING' && !p.handover.receiverConfirmedAt)),
      409,
      'STATE_CONFLICT',
      'Challenge requires an arrived, unconfirmed pickup',
    );
    ensure(
      v.quantity <= Number(p.lot.quantityValue),
      422,
      'QUANTITY_EXCEEDED',
      'Actual quantity cannot exceed reserved quantity',
    );
    ensure(
      v.quantity === Number(p.lot.quantityValue) ||
        (v.discrepancyReason && v.discrepancyReason.trim().length >= 5),
      422,
      'REASON_REQUIRED',
      'Explain a partial handover',
    );
    ensure(
      p.lot.quantityUnit !== 'KG' || v.weightKg === undefined || v.weightKg === v.quantity,
      422,
      'WEIGHT_MISMATCH',
      'For KG lots verified weight must match actual quantity',
    );
    const code = String(randomInt(100000, 1000000)),
      salt = randomBytes(16).toString('hex');
    const data = {
      donorActorId: a.id,
      verifiedQuantityValue: v.quantity,
      verifiedQuantityUnit: p.lot.quantityUnit,
      verifiedWeightKg: p.lot.quantityUnit === 'KG' ? v.quantity : v.weightKg,
      discrepancyReason: v.discrepancyReason,
      codeHash: `${salt}:${digest(salt, code)}`,
      codeExpiresAt: new Date(Math.min(Date.now() + 5 * 60000, +p.pickupEnd)),
    };
    const h = await t.handover.upsert({
      where: { pickupId: id },
      create: { pickupId: id, ...data },
      update: data,
    });
    await audit(t, a, p.lot.donorOrganizationId, 'Handover', h.id, 'CHALLENGE_ISSUED');
    return { code, expiresAt: h.codeExpiresAt };
  });
}
export async function verifyCode(a: Actor, id: string, input: unknown, key?: string) {
  await rateLimit(`otp:${a.id}:${id}`, 10, 600);
  const v = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(input);
  const result = await transaction(async (t) => {
    const p = await scopedPickup(t, a, id),
      h = p.handover;
    const receiver = a.memberships.some(
      (m) =>
        m.role === 'RECIPIENT_MANAGER' &&
        m.organizationId === p.recipientOrganizationId &&
        m.organization.verificationStatus === 'VERIFIED',
    );
    const dispatcher =
      p.dispatcherUserId === a.id &&
      a.memberships.some(
        (m) => m.role === 'DISPATCHER' && m.organization.verificationStatus === 'VERIFIED',
      );
    ensure(
      receiver || dispatcher,
      403,
      'FORBIDDEN',
      'Receiving party or assigned dispatcher required',
    );
    ensure(
      p.lot.donor.verificationStatus === 'VERIFIED' &&
        p.recipient.verificationStatus === 'VERIFIED',
      409,
      'PARTNER_UNVERIFIED',
      'Both organizations must remain verified',
    );
    ensure(h, 409, 'NO_CHALLENGE', 'Ask donor to issue a handover code');
    if (await idempotent(t, a, key, 'verify', id)) return { receiverConfirmed: true };
    ensure(
      h.status === 'PENDING' && !h.receiverConfirmedAt && p.status === 'ARRIVED',
      409,
      'PROOF_CONSUMED',
      'Code has already been consumed or pickup closed',
    );
    const attempts = await t.handoverAttempt.count({
      where: { handoverId: h.id, successful: false },
    });
    ensure(attempts < 5, 429, 'PROOF_LOCKED', 'Too many failed attempts; contact the donor');
    const [salt, expected] = h.codeHash.split(':');
    const valid =
      h.codeExpiresAt > new Date() &&
      p.pickupStart <= new Date() &&
      p.pickupEnd > new Date() &&
      timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(digest(salt, v.code), 'hex'));
    await t.handoverAttempt.create({
      data: {
        handoverId: h.id,
        actorId: a.id,
        successful: valid,
        reasonCode: valid
          ? 'RECEIVER_CONFIRMED'
          : h.codeExpiresAt <= new Date()
            ? 'EXPIRED_CODE'
            : 'WRONG_CODE',
      },
    });
    await audit(
      t,
      a,
      p.recipientOrganizationId,
      'Handover',
      h.id,
      valid ? 'RECEIVER_CONFIRMED' : 'FAILED_ATTEMPT',
    );
    if (!valid) {
      await t.idempotency.deleteMany({ where: { actorId: a.id, key } });
      return { error: true };
    }
    await t.handover.update({
      where: { id: h.id },
      data: {
        receiverActorId: a.id,
        receiverConfirmedAt: new Date(),
        codeHash: `${salt}:${digest(salt, randomBytes(32).toString('hex'))}`,
      },
    });
    return { receiverConfirmed: true };
  });
  ensure(!('error' in result), 422, 'INVALID_CODE', 'Code is invalid or expired');
  return result;
}
export async function confirm(a: Actor, id: string, key?: string) {
  verified(a, 'DONOR_MANAGER');
  return transaction(async (t) => {
    const p = await scopedPickup(t, a, id),
      h = p.handover;
    ensure(
      a.memberships.some(
        (m) => m.role === 'DONOR_MANAGER' && m.organizationId === p.lot.donorOrganizationId,
      ),
      403,
      'FORBIDDEN',
      'Donor confirmation required',
    );
    ensure(h, 409, 'NO_CHALLENGE', 'Handover proof missing');
    if (await idempotent(t, a, key, 'confirm', id)) return { receiptReference: h.receiptReference };
    ensure(
      p.recipient.verificationStatus === 'VERIFIED',
      409,
      'RECIPIENT_UNVERIFIED',
      'Recipient must remain verified',
    );
    ensure(
      h.status === 'PENDING' &&
        h.receiverConfirmedAt &&
        h.receiverActorId !== a.id &&
        p.status === 'ARRIVED' &&
        p.pickupStart <= new Date() &&
        p.pickupEnd > new Date(),
      409,
      'STATE_CONFLICT',
      'Receiver must confirm before donor finalization within pickup window',
    );
    const now = new Date();
    await t.handover.update({
      where: { id: h.id },
      data: { status: 'VERIFIED', verifiedAt: now, donorActorId: a.id },
    });
    await t.pickup.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now } });
    await t.lot.update({
      where: { id: p.lotId },
      data: { status: 'HANDED_OVER', version: { increment: 1 } },
    });
    await audit(
      t,
      a,
      p.lot.donorOrganizationId,
      'Handover',
      h.id,
      'HANDOVER_VERIFIED',
      'PENDING',
      'VERIFIED',
      {
        pickupId: id,
        recipientOrganizationId: p.recipientOrganizationId,
        quantity: String(h.verifiedQuantityValue),
        unit: h.verifiedQuantityUnit,
        receiptReference: h.receiptReference,
      },
    );
    await notify(
      t,
      [p.lot.donorOrganizationId, p.recipientOrganizationId],
      'HANDOVER_VERIFIED',
      `Verified handover: ${p.lot.title}`,
      '/app/impact',
      p.dispatcherUserId ? [p.dispatcherUserId] : [],
    );
    return { receiptReference: h.receiptReference };
  });
}
export async function receipt(a: Actor, id: string) {
  const p = await getPickup(a, id);
  ensure(
    p.handover?.status === 'VERIFIED',
    409,
    'NOT_VERIFIED',
    'Receipt available only for a verified handover',
  );
  return p;
}
export async function impact(a: Actor) {
  const ids = a.memberships.map((m) => m.organizationId),
    donorIds = a.memberships.filter((m) => m.role === 'DONOR_MANAGER').map((m) => m.organizationId),
    recipientIds = a.memberships
      .filter((m) => m.role === 'RECIPIENT_MANAGER')
      .map((m) => m.organizationId);
  const lotWhere: Prisma.LotWhereInput = a.platformAdmin
    ? {}
    : { donorOrganizationId: { in: donorIds } };
  const scope = pickupScope(a),
    verifiedWhere: Prisma.HandoverWhereInput = { status: 'VERIFIED', pickup: scope };
  const acceptedScope: Prisma.OfferWhereInput = a.platformAdmin
    ? {}
    : {
        OR: [
          { lot: { donorOrganizationId: { in: donorIds } } },
          { recipientOrganizationId: { in: recipientIds } },
        ],
      };
  const [
    lotCounts,
    listed,
    acceptedQuantitiesRows,
    verifiedRows,
    weight,
    verifiedHandovers,
    failedPickups,
    acceptedToday,
    median,
  ] = await Promise.all([
    db.lot.groupBy({ by: ['status'], where: lotWhere, _count: true }),
    db.lot.groupBy({
      by: ['quantityUnit'],
      where: { ...lotWhere, status: { not: 'DRAFT' } },
      _sum: { quantityValue: true },
    }),
    db.lot.groupBy({
      by: ['quantityUnit'],
      where: { offers: { some: { ...acceptedScope, acceptedAt: { not: null } } } },
      _sum: { quantityValue: true },
    }),
    db.handover.groupBy({
      by: ['verifiedQuantityUnit'],
      where: verifiedWhere,
      _sum: { verifiedQuantityValue: true },
    }),
    db.handover.aggregate({ where: verifiedWhere, _sum: { verifiedWeightKg: true } }),
    db.handover.count({ where: verifiedWhere }),
    db.pickup.count({ where: { ...scope, status: 'FAILED' } }),
    db.offer.count({
      where: {
        ...acceptedScope,
        acceptedAt: { gte: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') },
      },
    }),
    db.$queryRaw<{ median: number | null }[]>(
      Prisma.sql`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o."acceptedAt"-l."createdAt"))/60) AS median FROM "Offer" o JOIN "Lot" l ON l.id=o."lotId" WHERE o."acceptedAt" IS NOT NULL AND ${a.platformAdmin ? Prisma.sql`TRUE` : Prisma.sql`(l."donorOrganizationId" IN (${Prisma.join(donorIds.length ? donorIds : ['__no_org__'])}) OR o."recipientOrganizationId" IN (${Prisma.join(recipientIds.length ? recipientIds : ['__no_org__'])}))`}`,
    ),
  ]);
  const units = { MEAL: 0, KG: 0, ITEM: 0 },
    listedQuantities = { ...units },
    acceptedQuantities = { ...units };
  for (const row of listed)
    listedQuantities[row.quantityUnit as keyof typeof units] = Number(row._sum.quantityValue ?? 0);
  for (const row of acceptedQuantitiesRows)
    acceptedQuantities[row.quantityUnit as keyof typeof units] = Number(
      row._sum.quantityValue ?? 0,
    );
  for (const row of verifiedRows)
    units[row.verifiedQuantityUnit as keyof typeof units] = Number(
      row._sum.verifiedQuantityValue ?? 0,
    );
  return {
    period: 'All time (acceptedToday: UTC calendar day)',
    provenance: 'PostgreSQL aggregation of verified handover ledger; demo organizations labeled',
    openLots: lotCounts.find((r) => r.status === 'OPEN')?._count ?? 0,
    acceptedToday,
    verifiedHandovers,
    lotsCollected: verifiedHandovers,
    verifiedMeals: units.MEAL,
    verifiedKgDiverted: Number(weight._sum.verifiedWeightKg ?? 0),
    verifiedQuantities: units,
    listedQuantities,
    acceptedQuantities,
    expiredLots: lotCounts.find((r) => r.status === 'EXPIRED')?._count ?? 0,
    failedPickups,
    medianListingToAcceptanceMinutes: median[0]?.median ?? null,
    organizationScope: ids,
  };
}
export async function audits(a: Actor, skip = 0) {
  return db.auditEvent.findMany({
    where: a.platformAdmin
      ? {}
      : {
          OR: [
            { organizationId: { in: a.memberships.map((m) => m.organizationId) } },
            { actorId: a.id },
          ],
        },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip,
    take: 50,
  });
}
export async function explain(a: Actor) {
  await rateLimit(`assistant:${a.id}`, 20);
  const lots = await listLots(a);
  const pickups = await listPickups(a);
  return {
    mode: 'DETERMINISTIC',
    summary: `${lots.filter((l) => l.status === 'OPEN').length} visible open lots; ${pickups.filter((p) => !terminal.includes(p.status)).length} active pickups. Collection suitability must be assessed by operators.`,
    citations: [
      ...lots.slice(0, 5).map((l) => ({
        type: 'Lot',
        id: l.id,
        fact: `${l.title}: ${l.status}; ${l.quantityValue} ${l.quantityUnit}; window ends ${l.pickupEnd.toISOString()}`,
      })),
      ...pickups.slice(0, 5).map((p) => ({
        type: 'Pickup',
        id: p.id,
        fact: `${p.status}; deadline ${p.pickupEnd.toISOString()}`,
      })),
    ],
  };
}
export { AppError };
