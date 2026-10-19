---
name: frontend-ux
description: Repository-local FoodLoop guidance for operational forms, responsive pages and accessibility.
---

# Frontend Ux

## When to use

Operational forms, responsive pages and accessibility. This file is repository-local authoring guidance, not an installed external skill.

## Responsibilities and sources

Own correctness and documentation in: src/components/console.tsx, src/app/globals.css, tests/e2e/donation.spec.ts. Read AGENTS.md and docs/PROGRESS.md first.

## Invariants

No dummy actions or fake metrics; label fields; expose errors; show demo provenance and explicit units.

## Implementation steps

Read role contracts; implement loading/empty/error/confirmation states; test narrow widths and keyboard focus; capture real screenshots.

## Tests

npm run lint; npm run typecheck; npm run test:e2e. Record commands, counts, failures and limitations without inventing outcomes.

## Definition of done

The affected workflow works through DB, API and UI; relevant positive and negative gates pass; docs/TRACEABILITY.md and docs/PROGRESS.md reflect evidence. External blockers are explicit; no unfinished feature is presented as complete.

Commercial release work must also read docs/RELEASE_READINESS.md and docs/PAKISTAN_LAUNCH.md. Preserve account token/MFA/outbox/session/invitation invariants, distinguish technical readiness from owner/legal approval, and keep development mailbox/keys out of exports. No public deployment, live billing or actual external message sending is authorized by local test success.
