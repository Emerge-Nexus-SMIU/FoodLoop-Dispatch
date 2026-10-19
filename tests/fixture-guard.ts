export function assertFixtureDatabase() {
  const raw = process.env.DATABASE_URL;
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Error('Tests require an explicitly configured local fixture database.');
  }
  if (
    process.env.ALLOW_DEMO_SEED !== 'true' ||
    !['localhost', '127.0.0.1', 'db'].includes(url.hostname) ||
    /production|pilot|live/i.test(url.pathname)
  )
    throw new Error(
      'Refusing fixture tests: use an isolated local database with ALLOW_DEMO_SEED=true. Never run against production/pilot data.',
    );
  process.env.MAIL_TRANSPORT = 'file';
}
