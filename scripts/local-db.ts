import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
const directory = path.resolve('.local/postgres');
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: 'foodloop',
  password: 'foodloop_local',
  port: 5432,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
if (!fs.existsSync(`${directory}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase('foodloop');
} catch (e) {
  if (!String(e).includes('already exists')) throw e;
}
console.log('Local PostgreSQL ready on 5432. Keep this process running.');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await pg.stop();
    process.exit(0);
  });
await new Promise(() => {});
