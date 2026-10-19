---
name: security-qa
description: Repository-local FoodLoop guidance for auth, proof, tenant isolation and release review.
---

# Security Qa

## When to use

Auth, proof, tenant isolation and release review. This file is repository-local authoring guidance, not an installed external skill.

## Responsibilities and sources

Own correctness and documentation in: src/server/auth.ts, src/server/service.ts, docs/SECURITY.md, tests. Read AGENTS.md and docs/PROGRESS.md first.

## Invariants

No plaintext persisted OTP or sessions; origin/role/tenant checks; fail closed; no verification bypass.

## Implementation steps

Enumerate actor and tenant boundaries; add negative/race/replay tests; audit production dependencies; record actual outcomes and unresolved risk.

## Tests

npm run lint; npm run typecheck; npm test; npm run test:integration; npm run test:e2e; npm audit --omit=dev. Record commands, counts, failures and limitations without inventing outcomes.

## Definition of done

The affected workflow works through DB, API and UI; relevant positive and negative gates pass; docs/TRACEABILITY.md and docs/PROGRESS.md reflect evidence. External blockers are explicit; no unfinished feature is presented as complete.

Commercial release work must also read docs/RELEASE_READINESS.md and docs/PAKISTAN_LAUNCH.md. Preserve account token/MFA/outbox/session/invitation invariants, distinguish technical readiness from owner/legal approval, and keep development mailbox/keys out of exports. No public deployment, live billing or actual external message sending is authorized by local test success.
