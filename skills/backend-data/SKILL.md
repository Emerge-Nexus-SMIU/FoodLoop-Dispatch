---
name: backend-data
description: Repository-local FoodLoop guidance for schema, api and transaction changes.
---

# Backend Data

## When to use

Schema, API and transaction changes. This file is repository-local authoring guidance, not an installed external skill.

## Responsibilities and sources

Own correctness and documentation in: prisma/schema.prisma, prisma/migrations, src/server/service.ts, src/app/api/v1/[...path]/route.ts. Read AGENTS.md and docs/PROGRESS.md first.

## Invariants

Tenant predicates on every resource query; one accepted recipient; append-only history.

## Implementation steps

Read migration history; add forward migration; enforce transition in service transaction; bound and validate inputs; append audit.

## Tests

npm run db:migrate; npm run typecheck; npm run test:integration. Record commands, counts, failures and limitations without inventing outcomes.

## Definition of done

The affected workflow works through DB, API and UI; relevant positive and negative gates pass; docs/TRACEABILITY.md and docs/PROGRESS.md reflect evidence. External blockers are explicit; no unfinished feature is presented as complete.

Commercial release work must also read docs/RELEASE_READINESS.md and docs/PAKISTAN_LAUNCH.md. Preserve account token/MFA/outbox/session/invitation invariants, distinguish technical readiness from owner/legal approval, and keep development mailbox/keys out of exports. No public deployment, live billing or actual external message sending is authorized by local test success.
