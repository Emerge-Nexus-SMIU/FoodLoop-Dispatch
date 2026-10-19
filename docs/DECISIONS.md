# Architecture decisions

1. **Single app + PostgreSQL**: matches the source concept, permits atomic reservations without distributed coordination. No microservices or queue.
2. **Prisma 7.10.1 + JS pg adapter**: Prisma 6 native artifact download was denied by the cloud network. Upgraded to the supported WASM/JS toolchain; generation, SQL diff and deployment succeeded without bypassing checksums/TLS. Artifact domains are no longer a runtime requirement.
3. **Explicit credential sessions**: implemented a small same-origin session subsystem rather than Auth.js; fewer provider assumptions but more owned security work. Password recovery/email verification remain deployment gates.
4. **OTP + two-party confirmation**: no camera dependency, hashed proof, receiver consumption then donor finalization, no impact before finalization. Repeated bad attempts lock the pickup's proof.
5. **Capacity per lot**: exact-unit declared maximum; no cross-lot/day capacity promise. Absolute availability rather than speculative recurring schedules.
6. **Plain CSS/native controls**: small client dependency set, responsive operational style, no mock charts/maps. Components can be split as the codebase grows.
7. **No automated safety/AI authority**: zero-key deterministic summary cites authorized records. LLM integration is optional future work.
8. **No deployment/push**: local validation and artifacts only; remote hosting and Git push require explicit user authorization.

Correction after clean-install verification: Prisma 7 removes native query-engine needs for the running JS-driver app, but its CLI still requires the official schema engine. A late clean reinstall exposed a 403 on that download; `binaries.prisma.sh` remains a required install destination. Successful current-instance tests and a built runtime do not establish a fresh cloud installation.

## Commercial hardening verification update — 19 October 2026

Current authoritative totals supersede earlier baseline evidence: 40 unit, 34 real PostgreSQL integration and 6 browser tests (80 total), all passing. Additional coverage is in tests/unit/security.test.ts, tests/unit/release.test.ts, tests/integration/release-hardening.test.ts and tests/e2e/account-security.spec.ts. Accounts, invitations, encrypted mail outbox, settings, inbox, policy, disputes, CSV, pagination and release gates are implemented. Clean installation, Prisma generation/schema checks and the full online Dockerfile build now pass; earlier binary/network blockers are resolved. See QA_REPORT.md and RELEASE_READINESS.md for exact limits and remaining external launch gates.
