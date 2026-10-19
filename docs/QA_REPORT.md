# QA report — 19 October 2026

## Final verified results

| Gate                                                    | Result                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Clean lockfile installation (`npm ci`)                  | Passed                                                                                        |
| Prisma generation, both migrations and schema diff      | Passed; no pending migration or schema difference                                             |
| Formatting, ESLint and TypeScript                       | Passed                                                                                        |
| Unit tests                                              | **40 passed**, 3 files                                                                        |
| Real PostgreSQL integration tests                       | **34 passed**, 2 files                                                                        |
| Playwright Chromium tests                               | **6 passed**, no skipped/expected failures; final run 58.8s                                   |
| Optimized production build                              | Passed after final UI changes                                                                 |
| Full dependency audit                                   | **0 vulnerabilities** at verification time                                                    |
| Standard Dockerfile online dependency install and build | Passed with the environment's trusted proxy CA; TLS verification retained                     |
| Fresh Docker PostgreSQL 18 migrations and seed          | Passed, both tracked migrations                                                               |
| Production Docker application workflow                  | Passed: distinct actors confirm exactly 25 additional meals and retrieve the verified receipt |
| Encrypted local backup/restore rehearsal                | Passed: restored audit/receipt totals and database guards match                               |
| Restricted database role                                | Audit update, verified receipt update and schema creation rejected                            |

**80 automated tests passed.** Tests require explicitly opted-in disposable local fixture databases. No production records were used. The former Prisma host 403 and Docker online-build blockers are resolved in this environment; the supported JS query adapter still requires the official CLI engine download for schema operations. No checksum or TLS bypass was used.

## Coverage

The full donor/admin/recipient/dispatcher workflow proves verification, eligibility explanations, exclusive acceptance, scheduling, dispatch, expiring proof, receiver consumption, donor confirmation and verified-only impact. Integration covers reservation races, tenant isolation, stale eligibility, suspension, time boundaries, partial quantities, separated measurement units, proof expiry/replay/lockout, immutable receipts and append-only audits.

Hardening adds verified-email access control; hashed one-time recovery/verification/invitation tokens; encrypted MFA and mail payloads; TOTP replay protection; concurrent recovery-code consumption; password-reset session revocation; scoped invitations/removal/settings; notifications; policy validation; disputes; partial-success batch dispatch; scoped formula-safe CSV exports; production demo/admin MFA restrictions; mocked mail-provider success/failure/idempotency; streamed request limits and readiness configuration checks.

Browser tests cover account verification, password recovery, MFA/recovery codes, team invitations/settings/removal, mobile menu reachability, exports, disputes and inbox. Axe checks pass on sampled public/legal/account pages; keyboard/focus and responsive overflow checks pass. This is not a complete manual WCAG certification.

Production headers were checked for nonce CSP without unsafe-inline/unsafe-eval; session cookies use Secure, HttpOnly and SameSite=Lax. Local demo readiness explicitly reports `commercialRelease:false`. The release checker intentionally returns NO-GO for demo/development configuration and missing launch settings.

## Operational validation and limits

A complete online Dockerfile build passed. The final host production artifacts are also packaged into the same slim non-root runtime layout for final runtime validation. The final `commercial-final` container also passed the full handover smoke test with exactly 25 additional confirmed meals. PostgreSQL and application containers were tested together; the entire unmodified Compose orchestration was not exercised as one command. Compose remains a local demonstration configuration.

An encrypted dump was restored into a separate local fixture database; 13 audits, one verified receipt, 25 meals and two immutability guards matched at rehearsal time. This does not establish production offsite backups, key custody, recovery objectives or ongoing monitoring.

File mail delivery and mocked Resend HTTP behavior passed. **Actual external email delivery is not verified.** No remote deployment, push, paid service, published-task restoration, production load test, independent penetration review or full manual accessibility review occurred. See RELEASE_READINESS.md for required owner and operational gates. Intermediate failed diagnostic runs were fixed and are not counted as successful verification.
