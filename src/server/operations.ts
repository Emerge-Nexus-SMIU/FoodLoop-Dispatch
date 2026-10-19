import { z } from 'zod';
import { db } from './db';
import { type Actor, requireRole, requireAdmin, rateLimit } from './auth';
import { ensure } from './errors';
import { transaction, getPickup, pickupAction } from './service';
import { issueAction, appOrigin, securityAudit } from './accounts';
import { tokenHash } from './crypto';
import { queueMail } from './mail';
import { notify } from './notifications';
import { orgSchema } from './schemas';
function manager(a: Actor) {
  const m = a.memberships.find((m) => ['DONOR_MANAGER', 'RECIPIENT_MANAGER'].includes(m.role));
  ensure(m, 403, 'FORBIDDEN', 'Organization manager required');
  requireRole(a, m.role);
  return m;
}
export async function settings(a: Actor, input: unknown) {
  const m = manager(a),
    v = orgSchema.omit({ type: true }).parse(input);
  return transaction(async (t) => {
    const previous = await t.organization.findUniqueOrThrow({ where: { id: m.organizationId } });
    const identityChanged = previous.name !== v.name;
    if (identityChanged) {
      const active = await t.pickup.count({
        where: {
          OR: [
            { lot: { donorOrganizationId: m.organizationId } },
            { recipientOrganizationId: m.organizationId },
          ],
          status: { notIn: ['COMPLETED', 'FAILED', 'CANCELED'] },
        },
      });
      const open = await t.lot.count({
        where: {
          donorOrganizationId: m.organizationId,
          status: { in: ['OPEN', 'RESERVED', 'PICKUP_IN_PROGRESS'] },
        },
      });
      ensure(
        active === 0 && open === 0,
        409,
        'ACTIVE_OPERATIONS',
        'Finish or cancel active donations before changing organization identity',
      );
    }
    const org = await t.organization.update({
      where: { id: m.organizationId },
      data: {
        name: v.name,
        contact: v.contact,
        timezone: v.timezone,
        ...(identityChanged ? { verificationStatus: 'PENDING' } : {}),
      },
    });
    const location = await t.location.findFirst({
      where: { organizationId: org.id },
      orderBy: { id: 'asc' },
    });
    if (location)
      await t.location.update({
        where: { id: location.id },
        data: { address: v.address, latitude: v.latitude, longitude: v.longitude },
      });
    await securityAudit(t, a.id, 'ORGANIZATION_SETTINGS_UPDATED', org.id, org.id);
    return org;
  });
}
export async function members(a: Actor) {
  const m = manager(a);
  const rows = await db.membership.findMany({
    where: { organizationId: m.organizationId },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true, active: true } },
    },
    orderBy: { id: 'asc' },
    take: 200,
  });
  const pending = await db.actionToken.findMany({
    where: {
      organizationId: m.organizationId,
      kind: 'INVITE',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, email: true, role: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return { members: rows, invitations: pending };
}
export async function invite(a: Actor, input: unknown) {
  const m = manager(a);
  ensure(
    m.organization.verificationStatus === 'VERIFIED',
    403,
    'ORG_UNVERIFIED',
    'Verify your organization first',
  );
  const v = z
    .object({
      email: z.email().max(200),
      role: z.enum(['DONOR_MANAGER', 'RECIPIENT_MANAGER', 'DISPATCHER']),
    })
    .parse(input);
  const email = v.email.toLowerCase();
  ensure(
    v.role === 'DISPATCHER' || v.role === m.role,
    422,
    'INVALID_ROLE',
    'Choose a role appropriate to your organization',
  );
  await rateLimit(`invite:${a.id}`, 20, 3600);
  await transaction(async (t) => {
    await t.actionToken.updateMany({
      where: { organizationId: m.organizationId, email, kind: 'INVITE', consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const raw = await issueAction(t, 'INVITE', email, undefined, m.organizationId, v.role);
    await queueMail(t, {
      to: email,
      subject: `Invitation to ${m.organization.name} on FoodLoop Dispatch`,
      text: `You have been invited as ${v.role}. Sign in with this email address, then accept your invitation: ${appOrigin()}/invite?token=${raw}\nThis link expires in 24 hours. Ignore it if unexpected.`,
    });
    await securityAudit(t, a.id, 'MEMBER_INVITED', m.organizationId, m.organizationId);
  });
  return { message: 'Invitation queued for delivery.' };
}
export async function acceptInvite(a: Actor, token: string) {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(token);
  ensure(
    a.emailVerifiedAt,
    403,
    'EMAIL_UNVERIFIED',
    'Verify your email before accepting invitations',
  );
  return transaction(async (t) => {
    const invitation = await t.actionToken.findUnique({ where: { tokenHash: tokenHash(token) } });
    ensure(
      invitation?.kind === 'INVITE' &&
        invitation.email === a.email &&
        invitation.organizationId &&
        invitation.role &&
        !invitation.consumedAt &&
        invitation.expiresAt > new Date(),
      422,
      'INVALID_INVITATION',
      'Invitation is invalid, expired or belongs to another email',
    );
    const existing = await t.membership.findMany({ where: { userId: a.id } });
    ensure(
      existing.every((m) => m.organizationId === invitation.organizationId),
      409,
      'OTHER_ORGANIZATION',
      'This account already belongs to another organization',
    );
    const org = await t.organization.findUnique({ where: { id: invitation.organizationId } });
    ensure(
      org?.verificationStatus === 'VERIFIED',
      409,
      'ORG_UNVERIFIED',
      'Inviting organization is not currently verified',
    );
    const used = await t.actionToken.updateMany({
      where: { id: invitation.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    ensure(used.count === 1, 409, 'INVITATION_USED', 'Invitation already accepted');
    const member = await t.membership.upsert({
      where: { userId_organizationId: { userId: a.id, organizationId: org.id } },
      create: { userId: a.id, organizationId: org.id, role: invitation.role },
      update: {},
    });
    await securityAudit(t, a.id, 'INVITATION_ACCEPTED', org.id, org.id);
    return member;
  });
}
export async function revokeInvite(a: Actor, id: string) {
  const m = manager(a);
  return transaction(async (t) => {
    await t.actionToken.updateMany({
      where: { id, organizationId: m.organizationId, kind: 'INVITE', consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await securityAudit(t, a.id, 'INVITATION_REVOKED', id, m.organizationId);
    return { revoked: true };
  });
}
export async function removeMember(a: Actor, id: string) {
  const m = manager(a);
  return transaction(async (t) => {
    const member = await t.membership.findFirst({
      where: { id, organizationId: m.organizationId },
    });
    ensure(member, 404, 'NOT_FOUND', 'Membership not found');
    if (member.role === m.role)
      ensure(
        (await t.membership.count({ where: { organizationId: m.organizationId, role: m.role } })) >
          1,
        409,
        'LAST_MANAGER',
        'At least one organization manager must remain',
      );
    await t.membership.delete({ where: { id } });
    await t.session.deleteMany({ where: { userId: member.userId } });
    await securityAudit(t, a.id, 'MEMBER_REMOVED', id, m.organizationId);
    return { removed: true };
  });
}
export async function notifications(a: Actor, skip = 0) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: a.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take: 50,
    }),
    db.notification.count({ where: { userId: a.id, seenAt: null } }),
  ]);
  return { items, unread };
}
export async function readNotification(a: Actor, id?: string) {
  return db.notification.updateMany({
    where: { userId: a.id, seenAt: null, ...(id ? { id } : {}) },
    data: { seenAt: new Date() },
  });
}
export async function policy(a: Actor, input?: unknown) {
  requireAdmin(a);
  if (input === undefined)
    return (
      (await db.matchingPolicy.findUnique({ where: { id: 'active' } })) ?? {
        capacityWeight: 35,
        windowWeight: 35,
        distanceWeight: 30,
        version: 1,
      }
    );
  const v = z
    .object({
      capacityWeight: z.number().int().min(0).max(100),
      windowWeight: z.number().int().min(0).max(100),
      distanceWeight: z.number().int().min(0).max(100),
    })
    .refine(
      (v) =>
        v.capacityWeight + v.windowWeight + v.distanceWeight === 100 &&
        v.capacityWeight + v.windowWeight > 0,
      'Weights must total 100 with a non-distance component',
    )
    .parse(input);
  return transaction(async (t) => {
    const result = await t.matchingPolicy.upsert({
      where: { id: 'active' },
      create: { id: 'active', ...v, version: 2 },
      update: { ...v, version: { increment: 1 } },
    });
    await securityAudit(t, a.id, 'MATCHING_POLICY_UPDATED', 'active');
    return result;
  });
}
export async function disputes(a: Actor) {
  return db.dispute.findMany({
    where: a.platformAdmin
      ? {}
      : { organizationId: { in: a.memberships.map((m) => m.organizationId) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 100,
  });
}
export async function openDispute(a: Actor, input: unknown) {
  const v = z
    .object({ pickupId: z.string(), reason: z.string().trim().min(12).max(2000) })
    .parse(input);
  const p = await getPickup(a, v.pickupId);
  const orgId =
    a.memberships.find((m) =>
      [p.lot.donorOrganizationId, p.recipientOrganizationId].includes(m.organizationId),
    )?.organizationId ?? a.memberships[0]?.organizationId;
  ensure(orgId, 403, 'FORBIDDEN', 'An organization membership is required');
  await rateLimit(`dispute:${a.id}`, 10, 3600);
  return transaction(async (t) => {
    const d = await t.dispute.create({
      data: { pickupId: p.id, organizationId: orgId, openedById: a.id, reason: v.reason },
    });
    await securityAudit(t, a.id, 'DISPUTE_OPENED', d.id, orgId);
    const admins = await t.user.findMany({
      where: { platformAdmin: true, active: true },
      select: { id: true },
    });
    await notify(
      t,
      [],
      'DISPUTE_OPENED',
      'A pickup dispute needs review',
      '/admin/disputes',
      admins.map((u) => u.id),
    );
    return d;
  });
}
export async function resolveDispute(a: Actor, id: string, input: unknown) {
  requireAdmin(a);
  const v = z.object({ resolution: z.string().trim().min(12).max(2000) }).parse(input);
  return transaction(async (t) => {
    const d = await t.dispute.findUnique({ where: { id } });
    ensure(d, 404, 'NOT_FOUND', 'Dispute not found');
    ensure(d.status === 'OPEN', 409, 'DISPUTE_CLOSED', 'Dispute already resolved');
    const result = await t.dispute.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolution: v.resolution,
        resolvedById: a.id,
        resolvedAt: new Date(),
      },
    });
    await securityAudit(t, a.id, 'DISPUTE_RESOLVED', id, d.organizationId);
    await notify(
      t,
      [d.organizationId],
      'DISPUTE_RESOLVED',
      'Your pickup dispute has a resolution',
      '/app/disputes',
    );
    return result;
  });
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export async function exportData(a: Actor, kind: string) {
  await rateLimit(`export:${a.id}`, 10, 600);
  if (kind === 'audit') {
    const where = a.platformAdmin
      ? {}
      : {
          OR: [
            { organizationId: { in: a.memberships.map((m) => m.organizationId) } },
            { actorId: a.id },
          ],
        };
    const rows = await db.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 10001,
    });
    ensure(
      rows.length <= 10000,
      422,
      'EXPORT_LIMIT',
      'This export exceeds 10000 rows; request a scoped administrative report',
    );
    return {
      filename: 'foodloop-audit.csv',
      text: [
        ['Timestamp', 'Action', 'Entity', 'Entity ID', 'Actor'].map(csvCell).join(','),
        ...rows.map((r) =>
          [r.createdAt.toISOString(), r.action, r.entityType, r.entityId, r.actorId]
            .map(csvCell)
            .join(','),
        ),
      ].join('\r\n'),
    };
  }
  const scope = a.platformAdmin
    ? {}
    : {
        pickup: {
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
        },
      };
  const rows = await db.handover.findMany({
    where: { status: 'VERIFIED', ...scope },
    select: {
      receiptReference: true,
      verifiedAt: true,
      verifiedQuantityValue: true,
      verifiedQuantityUnit: true,
      verifiedWeightKg: true,
      pickupId: true,
    },
    orderBy: [{ verifiedAt: 'desc' }, { id: 'asc' }],
    take: 10001,
  });
  ensure(
    rows.length <= 10000,
    422,
    'EXPORT_LIMIT',
    'This export exceeds 10000 rows; request a scoped administrative report',
  );
  return {
    filename: 'foodloop-handovers.csv',
    text: [
      ['Receipt', 'Verified UTC', 'Actual quantity', 'Unit', 'Verified kg', 'Pickup']
        .map(csvCell)
        .join(','),
      ...rows.map((r) =>
        [
          r.receiptReference,
          r.verifiedAt?.toISOString(),
          r.verifiedQuantityValue,
          r.verifiedQuantityUnit,
          r.verifiedWeightKg,
          r.pickupId,
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n'),
  };
}

export async function batchAssign(a: Actor, input: unknown) {
  manager(a);
  await rateLimit(`batch:${a.id}`, 10, 600);
  const v = z
    .object({
      pickupIds: z
        .array(z.string())
        .min(1)
        .max(25)
        .refine((v) => new Set(v).size === v.length, 'Duplicate pickups are not allowed'),
      dispatcherUserId: z.string(),
    })
    .parse(input);
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const id of v.pickupIds) {
    try {
      await pickupAction(a, id, 'assign', { dispatcherUserId: v.dispatcherUserId });
      results.push({ id, ok: true, message: 'Assigned' });
    } catch (e) {
      results.push({
        id,
        ok: false,
        message: e instanceof Error ? e.message : 'Assignment failed',
      });
    }
  }
  return { results };
}

export async function operationalStatus(a: Actor) {
  requireAdmin(a);
  const [mail, organizations, failedPickups, expiredBacklog] = await Promise.all([
    db.mailOutbox.groupBy({ by: ['status'], _count: true }),
    db.organization.groupBy({ by: ['verificationStatus'], _count: true }),
    db.pickup.count({
      where: { status: 'FAILED', pickupEnd: { gte: new Date(Date.now() - 86400000) } },
    }),
    db.lot.count({
      where: {
        status: { in: ['OPEN', 'RESERVED', 'PICKUP_IN_PROGRESS'] },
        pickupEnd: { lte: new Date() },
      },
    }),
  ]);
  return {
    computedAt: new Date().toISOString(),
    mail: mail.map((r) => ({ status: r.status, count: r._count })),
    organizations: organizations.map((r) => ({ status: r.verificationStatus, count: r._count })),
    failedPickupsLast24Hours: failedPickups,
    expiredBacklog,
  };
}
