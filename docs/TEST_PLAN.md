# Test strategy

Tests use real PostgreSQL, not an in-memory replacement. Run on a disposable development database after migration and explicit demo seed. Never point tests at real operational records.

- Unit: every matching hard filter, score normalization without coordinates, exact expiry, offset-equivalent dates, distance calculation, positive/precision-bound quantities, incomplete handling/profile and reversed windows.
- Integration: admin approval and escalation, own versus unrelated resource queries, draft/publish state, stored evaluations, concurrent acceptance winner, idempotent acceptance, expired/suspended acceptance, unassigned dispatcher, arrival prerequisite, wrong/expired/replayed/locked OTP, final confirmation, verified-only quantities, partial quantity/reason bounds, mixed-unit separation and immutable ledger/receipt triggers.
- Playwright: real Chromium across independent donor/recipient/admin/dispatcher contexts; UI verification, lot entry/publish/matching/offers, exclusive reservation, scheduling/assignment/transit, two-party handover, 25 confirmed meals, deterministic assistant, screenshots and no horizontal overflow at 375/768/1440 widths. HTTP negative paths through the running app test auth, CSRF, masked tenancy, unverified acceptance, racing requests, expiry, capacity and proof replay.
- Quality: format, ESLint, TypeScript, migration status/diff, production build and npm production vulnerability audit. Docker build/runtime tested where available; report environment failures separately.

Browser retries are disabled; failures are diagnosed and corrected, not hidden. Screenshots/traces on failures live in ignored test-results; successful evidence is saved in docs/screenshots. Unit/integration test counts must come from runner output. Manual screen-reader/keyboard and independent penetration/load testing remain pilot gates, never implied by functional browser tests.

## Commercial hardening verification update — 19 October 2026

Current authoritative totals supersede earlier baseline evidence: 40 unit, 34 real PostgreSQL integration and 6 browser tests (80 total), all passing. Additional coverage is in tests/unit/security.test.ts, tests/unit/release.test.ts, tests/integration/release-hardening.test.ts and tests/e2e/account-security.spec.ts. Accounts, invitations, encrypted mail outbox, settings, inbox, policy, disputes, CSV, pagination and release gates are implemented. Clean installation, Prisma generation/schema checks and the full online Dockerfile build now pass; earlier binary/network blockers are resolved. See QA_REPORT.md and RELEASE_READINESS.md for exact limits and remaining external launch gates.
