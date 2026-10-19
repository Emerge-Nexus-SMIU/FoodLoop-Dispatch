# P0 traceability

Final implementation status is maintained in PROGRESS.md. All rows below have local functional evidence; external deployment and pilot gates remain separate.

| Requirement                          | Implementation                      | Evidence                     |
| ------------------------------------ | ----------------------------------- | ---------------------------- |
| US01 authentication, roles, approval | auth + organization services        | integration + browser        |
| US02 lot validation/publish          | lot service/forms                   | unit + integration + browser |
| US03 eligibility and reasons         | matching service                    | unit + integration           |
| US04 exclusive acceptance            | conditional reservation transaction | concurrent integration       |
| US05 dispatch                        | pickup service/forms                | integration + browser        |
| US06 two-party OTP, expiry/replay    | handover service                    | integration + browser        |
| US07 verified-only metrics           | impact aggregation                  | integration + browser        |
| US08 expiration                      | reconciliation + guarded writes     | boundary + integration       |
| US09 factual assistant               | deterministic authorized summary    | integration                  |
| US10 tenant isolation                | resource-scoped authorization       | negative integration         |
| responsive UI / local deployment     | Next.js + Docker + README           | browser + build              |

Final gates: 40 unit, 34 real PostgreSQL integration, 6 browser/HTTP tests passed. See QA_REPORT.md for commands, limitations and packaging evidence.

## Commercial hardening verification update — 19 October 2026

Current authoritative totals supersede earlier baseline evidence: 40 unit, 34 real PostgreSQL integration and 6 browser tests (80 total), all passing. Additional coverage is in tests/unit/security.test.ts, tests/unit/release.test.ts, tests/integration/release-hardening.test.ts and tests/e2e/account-security.spec.ts. Accounts, invitations, encrypted mail outbox, settings, inbox, policy, disputes, CSV, pagination and release gates are implemented. Clean installation, Prisma generation/schema checks and the full online Dockerfile build now pass; earlier binary/network blockers are resolved. See QA_REPORT.md and RELEASE_READINESS.md for exact limits and remaining external launch gates.
