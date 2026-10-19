import { assessReadiness } from '@/server/readiness';
import { db } from '@/server/db';
import { localDemoMode } from '@/server/auth';
export async function GET() {
  if (process.env.NODE_ENV !== 'production' || localDemoMode()) {
    try {
      await db.$queryRaw`SELECT 1`;
      return Response.json(
        { status: 'demo_only', commercialRelease: false },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch {
      return Response.json({ status: 'unavailable' }, { status: 503 });
    }
  }
  const issues = await assessReadiness();
  return Response.json(
    { status: issues.length ? 'not_ready' : 'technical_ready' },
    { status: issues.length ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
