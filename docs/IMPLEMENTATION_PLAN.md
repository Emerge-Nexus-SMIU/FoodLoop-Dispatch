# Implementation plan

Source: MASTER_SPEC.md v1.0. Build one Next.js application, Prisma/PostgreSQL, credential sessions, Zod validation, deterministic matching, Vitest and Playwright.

1. Foundation: schema/migration, demo seed, authentication and server authorization.
2. Donation: onboarding and approval, recipient profiles, lot CRUD and publication.
3. Matching/reservation: versioned hard filters and normalized scoring; transactional exclusive acceptance.
4. Dispatch: schedule/assign/state transitions; donor issues challenge after arrival, receiver verifies, donor confirms immutable receipt.
5. Reporting: verified-only quantities, audit ledger, read-only assistant.
6. Product: responsive role-aware UI and complete operational forms.
7. Hardening: negative tests, race tests, browser workflow, CI, Docker, docs and screenshots.
   Required gates: migration, lint, types, unit/integration/browser tests and production build. Optional external hosting, LLM, email and route providers are deferred. No physical food-safety certification.
