# FoodLoop Dispatch engineering rules

Read docs/MASTER_SPEC.md and docs/PROGRESS.md before changes. Work in this existing isolated checkout; do not create worktrees unless requested.
Enforce permissions and tenant scope in domain services. Never trust UI checks. Use database transactions for reservation and verification; all material changes append an audit event. Do not rewrite audit events or verified receipts.
Use UTC and server time. Never count unverified food as donated; keep MEAL, KG and ITEM separate. Never assert food safety. Keep OTPs hashed and out of logs. Never commit secrets.
Keep reusable guidance in skills/*/SKILL.md. After each phase update docs/PROGRESS.md with actual results. Run npm run lint, npm run typecheck, npm test, npm run test:integration, npm run test:e2e and npm run build before release. No pushes, paid services or external deployment without authorization.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
