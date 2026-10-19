import 'dotenv/config';
import { assessReadiness } from '../src/server/readiness';
import { db } from '../src/server/db';
const issues = await assessReadiness();
await db.$disconnect();
console.log(
  JSON.stringify(
    {
      status: issues.length ? 'NO_GO' : 'TECHNICAL_CONFIG_CHECK_PASSED',
      issues,
      manualGates: [
        'Actual email delivery proof',
        'Encrypted backup and restore rehearsal',
        'Independent security/accessibility review',
        'Owner/legal launch sign-off',
      ],
    },
    null,
    2,
  ),
);
process.exitCode = issues.length ? 1 : 0;
