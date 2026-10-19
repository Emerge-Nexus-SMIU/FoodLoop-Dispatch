import 'dotenv/config';
import { deliverMailBatch } from '../src/server/mail';
import { reconcile } from '../src/server/service';
import { db } from '../src/server/db';
import { Prisma } from '@prisma/client';
let stopped = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    stopped = true;
  });
while (!stopped) {
  let stage = 'reconcile';
  try {
    await reconcile();
    stage = 'mail';
    const mail = await deliverMailBatch();
    stage = 'session_cleanup';
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    stage = 'rate_limit_cleanup';
    await db.rateLimit.deleteMany({ where: { resetsAt: { lt: new Date(Date.now() - 86400000) } } });
    stage = 'token_cleanup';
    await db.actionToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) } },
    });
    console.log(JSON.stringify({ event: 'worker_tick', ...mail }));
  } catch (e) {
    if (process.argv.includes('--once')) process.exitCode = 1;
    console.error(
      JSON.stringify({
        event: 'worker_error',
        stage,
        type: e instanceof Error ? e.name : 'unknown',
        ...(e instanceof Prisma.PrismaClientKnownRequestError ? { code: e.code } : {}),
      }),
      // Do not log raw messages/meta: they can contain queries or connection details.
    );
  }
  if (process.argv.includes('--once')) break;
  await new Promise((r) => setTimeout(r, 30000));
}
await db.$disconnect();
