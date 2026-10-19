import 'dotenv/config';
import { deliverMailBatch } from '../src/server/mail';
import { reconcile } from '../src/server/service';
import { db } from '../src/server/db';
let stopped = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    stopped = true;
  });
while (!stopped) {
  try {
    await reconcile();
    const mail = await deliverMailBatch();
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.rateLimit.deleteMany({ where: { resetsAt: { lt: new Date(Date.now() - 86400000) } } });
    await db.actionToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) } },
    });
    console.log(JSON.stringify({ event: 'worker_tick', ...mail }));
  } catch (e) {
    console.error(
      JSON.stringify({ event: 'worker_error', type: e instanceof Error ? e.name : 'unknown' }),
    );
  }
  if (process.argv.includes('--once')) break;
  await new Promise((r) => setTimeout(r, 30000));
}
await db.$disconnect();
