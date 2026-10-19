import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { encrypt, decrypt } from './crypto';
import { ensure } from './errors';
export type Email = { to: string; subject: string; text: string };
export async function queueMail(t: Prisma.TransactionClient, message: Email) {
  await t.mailOutbox.create({ data: { payload: encrypt(JSON.stringify(message)) } });
}
export async function deliverMailBatch(limit = 25) {
  const now = new Date(),
    lease = new Date(Date.now() + 120000),
    claim = randomUUID();
  const rows = await db.$queryRaw<
    { id: string; payload: string; attempts: number }[]
  >`UPDATE "MailOutbox" SET status='PROCESSING',"lockedUntil"=${lease},"errorCode"=${claim} WHERE id IN (SELECT id FROM "MailOutbox" WHERE (status='PENDING' AND "availableAt"<=${now}) OR (status='PROCESSING' AND "lockedUntil"<${now}) ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING id,payload,attempts`;
  let sent = 0,
    failed = 0;
  for (const row of rows) {
    try {
      const message = JSON.parse(decrypt(row.payload)) as Email;
      const transport = process.env.MAIL_TRANSPORT ?? 'file';
      if (transport === 'file') {
        ensure(
          process.env.NODE_ENV !== 'production',
          503,
          'MAIL_CONFIG',
          'File mail transport is development-only',
        );
        const fs = await import('node:fs/promises');
        await fs.mkdir('.local/mail', { recursive: true, mode: 0o700 });
        await fs.writeFile(`.local/mail/${row.id}.json`, JSON.stringify(message), { mode: 0o600 });
      } else {
        ensure(
          transport === 'resend' && process.env.RESEND_API_KEY && process.env.MAIL_FROM,
          503,
          'MAIL_CONFIG',
          'Configure verified email delivery',
        );
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': row.id,
          },
          body: JSON.stringify({ from: process.env.MAIL_FROM, ...message }),
          signal: AbortSignal.timeout(15000),
        });
        ensure(r.ok, 503, 'MAIL_PROVIDER', 'Email provider rejected the request');
      }
      await db.mailOutbox.updateMany({
        where: { id: row.id, status: 'PROCESSING', errorCode: claim },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lockedUntil: null,
          errorCode: null,
          payload: encrypt(JSON.stringify({ redacted: true })),
        },
      });
      sent++;
    } catch {
      await db.mailOutbox.updateMany({
        where: { id: row.id, errorCode: claim },
        data: {
          attempts: { increment: 1 },
          status: row.attempts >= 7 ? 'FAILED' : 'PENDING',
          availableAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** row.attempts)),
          lockedUntil: null,
          errorCode: 'DELIVERY_FAILED',
        },
      });
      failed++;
    }
  }
  return { sent, failed };
}
