---
name: ai-matching
description: Repository-local FoodLoop guidance for eligibility, ranking or contextual summary changes.
---

# Ai Matching

## When to use

Eligibility, ranking or contextual summary changes. This file is repository-local authoring guidance, not an installed external skill.

## Responsibilities and sources

Own correctness and documentation in: src/server/matching.ts, src/server/service.ts, docs/MATCHING_ENGINE.md. Read AGENTS.md and docs/PROGRESS.md first.

## Invariants

Hard filters precede scoring; no invented coordinates/ETA/conversions; summaries cite authorized facts and cannot act.

## Implementation steps

Version policy; define normalization and missing-data behavior; persist evaluations; recompute eligibility during acceptance.

## Tests

npm test; npm run test:integration; assistant browser assertion. Record commands, counts, failures and limitations without inventing outcomes.

## Definition of done

The affected workflow works through DB, API and UI; relevant positive and negative gates pass; docs/TRACEABILITY.md and docs/PROGRESS.md reflect evidence. External blockers are explicit; no unfinished feature is presented as complete.
