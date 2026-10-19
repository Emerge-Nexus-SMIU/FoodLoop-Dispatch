---
name: product-domain
description: Repository-local FoodLoop guidance for scope and domain changes.
---

# Product Domain

## When to use

Scope and domain changes. This file is repository-local authoring guidance, not an installed external skill.

## Responsibilities and sources

Own correctness and documentation in: docs/MASTER_SPEC.md, docs/PRD.md, docs/STATE_MACHINES.md, src/server/service.ts. Read AGENTS.md and docs/PROGRESS.md first.

## Invariants

Keep confirmed donation separate from listing/reservation; never certify safety.

## Implementation steps

Trace each change to a user story; define actor/state/negative cases; update progress and scope.

## Tests

npm test; npm run test:integration; affected Playwright flow. Record commands, counts, failures and limitations without inventing outcomes.

## Definition of done

The affected workflow works through DB, API and UI; relevant positive and negative gates pass; docs/TRACEABILITY.md and docs/PROGRESS.md reflect evidence. External blockers are explicit; no unfinished feature is presented as complete.
