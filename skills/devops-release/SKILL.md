---
name: devops-release
description: Repository-local FoodLoop guidance for environment, ci and deployment changes.
---

# Devops Release

## When to use

Environment, CI and deployment changes. This file is repository-local authoring guidance, not an installed external skill.

## Responsibilities and sources

Own correctness and documentation in: Dockerfile, docker-compose.yml, .github/workflows/ci.yml, docs/DEPLOYMENT.md. Read AGENTS.md and docs/PROGRESS.md first.

## Invariants

No secrets in Git; no production demo seed; migrations never silently reset data; do not push/deploy without authorization.

## Implementation steps

Use existing checkout; install lockfile; migrate staging; validate health and full workflow; build immutable image; document backups and rollback.

## Tests

npm ci; npm run db:generate; npm run db:migrate; npm run build; docker compose config; appropriate CI gates. Record commands, counts, failures and limitations without inventing outcomes.

## Definition of done

The affected workflow works through DB, API and UI; relevant positive and negative gates pass; docs/TRACEABILITY.md and docs/PROGRESS.md reflect evidence. External blockers are explicit; no unfinished feature is presented as complete.

Commercial release work must also read docs/RELEASE_READINESS.md and docs/PAKISTAN_LAUNCH.md. Preserve account token/MFA/outbox/session/invitation invariants, distinguish technical readiness from owner/legal approval, and keep development mailbox/keys out of exports. No public deployment, live billing or actual external message sending is authorized by local test success.
