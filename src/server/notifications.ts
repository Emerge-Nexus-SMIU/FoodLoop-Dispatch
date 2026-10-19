import type { Prisma } from '@prisma/client';
export async function notify(
  t: Prisma.TransactionClient,
  organizationIds: string[],
  kind: string,
  title: string,
  href: string,
  userIds: string[] = [],
) {
  const members = await t.membership.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { userId: true },
  });
  const ids = [...new Set([...members.map((m) => m.userId), ...userIds])];
  if (ids.length)
    await t.notification.createMany({
      data: ids.map((userId) => ({ userId, kind, payload: { title, href } })),
    });
}
