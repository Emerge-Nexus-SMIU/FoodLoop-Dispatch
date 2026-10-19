import { releaseIssues, type ReleaseIssue } from './release';
import { db } from './db';
export async function assessReadiness() {
  const issues: ReleaseIssue[] = releaseIssues(process.env);
  try {
    const rows = await db.$queryRaw<
      { superuser: boolean; schemaCreate: boolean; ownsProtected: boolean }[]
    >`SELECT r.rolsuper AS superuser,has_schema_privilege(current_user,'public','CREATE') AS "schemaCreate",EXISTS(SELECT 1 FROM pg_class c WHERE c.relname IN ('AuditEvent','Handover') AND c.relowner=r.oid) AS "ownsProtected" FROM pg_roles r WHERE r.rolname=current_user`;
    if (rows[0]?.superuser || rows[0]?.schemaCreate || rows[0]?.ownsProtected)
      issues.push({
        code: 'DATABASE_ROLE',
        message: 'Use a restricted runtime database role distinct from the schema/migration owner',
      });
    if (
      await db.user.count({
        where: {
          OR: [
            { email: { endsWith: '@demo.foodloop.test' } },
            { memberships: { some: { organization: { demo: true } } } },
          ],
        },
      })
    )
      issues.push({
        code: 'DEMO_DATA',
        message: 'Use a fresh production database without demo identities/data',
      });
    if (
      await db.user.count({
        where: {
          platformAdmin: true,
          active: true,
          OR: [{ emailVerifiedAt: null }, { mfaSecret: null }],
        },
      })
    )
      issues.push({
        code: 'ADMIN_SECURITY',
        message: 'Every active administrator must verify email and enroll an authenticator',
      });
  } catch {
    issues.push({ code: 'DATABASE_CHECK', message: 'Database readiness could not be verified' });
  }
  return issues;
}
