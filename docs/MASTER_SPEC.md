# FOODLOOP DISPATCH — CODEX MASTER BUILD SPECIFICATION

Version: 1.0 | 19 October 2026

## ROLE AND MISSION

You are Codex acting as principal software engineer, product engineer, security reviewer, QA lead, and technical writer. Build **FoodLoop Dispatch**, a genuinely functional, production-oriented, multi-organization surplus-food donation and pickup coordination application. Do not deliver a static design, a mock-only UI, or placeholders advertised as working capabilities. Implement one complete, testable business workflow first, then expand systematically.

Source-of-truth concept: **NYLP AI Hackathon 2026, Second Student Group Portfolio**, FoodLoop Dispatch, pages 23–28. Preserve these defining properties: verified donors and recipients; time-bounded surplus lots; explainable eligibility and ranking based on capacity, distance and pickup-window fit; exclusive recipient acceptance; pickup scheduling; QR/OTP proof of handover; append-only audit trail; impact counted solely on confirmed handover; expiration without false donation claims. Original concept proposed Next.js, Postgres, rules matcher, optional map lookup, optional LLM summarization. The requirements below expand the original proposal into an implementation contract; clearly label expanded features and defer non-MVP ones.

## EXECUTION DIRECTIVES

1. Inspect repository and available tooling. Preserve existing work; do not overwrite without reading it. If repo is empty, initialize it.
2. Write `docs/IMPLEMENTATION_PLAN.md` and a requirement traceability checklist before implementing code.
3. Select practical supported package versions, lock dependencies, and document tradeoffs; avoid needless microservices.
4. Build in vertically integrated increments (DB → API → UI → tests) with runnable checkpoints.
5. Actually run migrations, typechecks, lint, unit tests, integration tests, browser tests, and production build. Fix defects, report commands and results precisely.
6. Never claim an API or deployment works if untested. Mark missing external credentials or hosting as explicit blockers; provide a local fully testable alternative.
7. Work autonomously on reasonable implementation details. Ask only for truly blocking external decisions such as real credentials, paid services, or permission to deploy to accounts.
8. Never commit secrets. Generate `.env.example`; keep real `.env` files ignored.
9. Keep product copy professional, accessible, responsive and concise. Avoid excessive gradients, decorative graphs, fake testimonials, and fictional performance metrics.
10. Maintain `docs/PROGRESS.md` with implemented, tested, blocked and deferred tasks.

## SCOPE AND PRIORITIZATION

### P0 — DEMONSTRABLE MVP (MUST SHIP FIRST)

- Authentication, organization onboarding, roles (platform admin, donor manager, recipient manager, dispatcher).
- Manual verification/approval by platform admin; demo organizations with safe fixture accounts.
- Donor CRUD for surplus lots with validated quantity, unit, pickup start/end, collection location, category, and human-declared handling requirements.
- Recipient directory with declared capacity, service radius and accepted food types.
- Deterministic rule-based eligibility filtering and explainable ranking.
- Offers with visible expiry and exclusive atomic acceptance by exactly one eligible recipient.
- Pickup record creation/assignment and simple state tracking.
- QR or six-digit one-time code bound to pickup, secure server-side validation, expiry, replay protection and handover evidence.
- Donation metrics derived from verified handovers only.
- Audit events for materially important business state transitions.
- Expired-lot behavior, negative cases, and automated tests.
- Mobile-responsive application, seeded demo scenarios, README, Docker local setup.

### P1 — POST-MVP PRODUCT HARDENING

- Invitations and multi-member organizations; organization settings; notification inbox; email through adapter; batch pickup support; CSV export; stronger dispatch route estimation; configurable matching weights; richer observability, reporting and organization-specific audit exports.

### P2 — PILOT / COMMERCIAL EXTENSION

- Donor subscriptions (illustrative pricing hypotheses: free for charity, US$79/mo donor outlet, US$249/mo partner network; NO live billing until separately approved); sustainability reporting with methodology and uncertainty; integrations, route optimization, network analytics, accessibility and localization improvements.

## USER ROLES AND PERMISSIONS

- PLATFORM_ADMIN: approve/suspend organizations; review all organizations and audits; manage policy settings; handle disputes; never impersonate or silently change completed handovers.
- DONOR_MANAGER: edit own organization's lots, view offers, schedule/confirm handover only for its lots, export its metrics.
- RECIPIENT_MANAGER: edit own organization's receiving profile, view only eligible offers (or its accepted ones), accept/reject offers, view pickups.
- DISPATCHER: see assigned pickups, update authorized pickup states, present code at handover; no access to unrelated organization private data.
- Optional VOLUNTEER: access ONLY pickups explicitly assigned to that user.
  All roles must be enforced server-side, not just hidden in UI. Every organization-scoped query filters tenant ownership.

## MAIN USER STORIES AND ACCEPTANCE CONDITIONS

US-01 Admin verifies organizations; pending/suspended recipients cannot accept.
US-02 Donor publishes 25 safely declared packed meals with pickup within 90 minutes; fields persist and validate.
US-03 Engine excludes unverified/out-of-range/incompatible/overcapacity/unavailable recipients and shows understandable reasons (protected details not leaked).
US-04 Eligible recipient accepts before expiry; simultaneous competing acceptances result in one success only.
US-05 Dispatcher records scheduled and actual pickup state; authorized users see updates.
US-06 Donor verifies pickup handover via QR/OTP; backend validates correct lot/recipient/time/actor, consumes token once and appends an audit event.
US-07 Analytics increment only after verified handover; failed, expired and canceled donations never count.
US-08 A lot with elapsed window becomes expired and cannot be accepted or confirmed unless a documented authorized workflow explicitly reopens it as a fresh lot.
US-09 AI assistant explains _stored facts_ and cites lot/match IDs; cannot execute acceptance or certify food safety.
US-10 Any user cannot access another tenant's lots, pickups, internal data or tokens.

## STATE MACHINES

Lot: DRAFT → OPEN → RESERVED → PICKUP_IN_PROGRESS → HANDED_OVER; alternative OPEN → EXPIRED; OPEN/RESERVED → CANCELED when permitted; RESERVED → OPEN only on documented withdrawal and only if still within window. Avoid independently editable state strings.
Offer: PENDING → ACCEPTED / DECLINED / EXPIRED / SUPERSEDED. A lot can have many offers but at most one active accepted reservation.
Pickup: REQUESTED → SCHEDULED → ASSIGNED → EN_ROUTE → ARRIVED → COMPLETED; cancellation/failure branches with reason, actor and timestamp. Allow shortcuts only if documented, authorized and validated.
Handover: PENDING → VERIFIED (one-way), otherwise FAILED_ATTEMPT logged; never record a verified donation before a valid proof.
Clarify whether collector or donor shows OTP: implement donor-generated short-lived challenge displayed only after pickup arrival and entered by authorized recipient/dispatcher, with donor-side final confirmation if available. In P0 prefer a controlled, explicit handover confirmation protocol involving both parties.
Time: persist UTC timestamps, render in organization timezone; use server/database time for enforcement. Treat `pickupEnd <= now` as non-accepting. Grace periods, if any, must be explicit policy and must not imply suitability.

## DATA MODEL (PRISMA / POSTGRES)

`User(id, email unique, passwordHash or authProviderId, name, active, createdAt)`
`Organization(id, name, type DONOR|RECIPIENT|LOGISTICS, verificationStatus PENDING|VERIFIED|SUSPENDED, contact, timezone, createdAt)`
`Membership(id, userId, organizationId, role, unique(userId,organizationId))`
`Location(id, organizationId, label, address, latitude?, longitude?, geoSource, contactInstructions)`
`RecipientProfile(id, organizationId unique, capacityValue, capacityUnit, serviceRadiusKm, acceptedCategories, pickupAvailability, specialHandlingCapabilities)`
`Lot(id, donorOrganizationId, locationId, title, category, description, quantityValue Decimal, quantityUnit enum MEAL|KG|ITEM, declaredWeightKg Decimal?, packaging, allergensNote?, handlingDeclaration, storageRequirements?, pickupStart, pickupEnd, status, createdById, createdAt, updatedAt, version)`
`EligibilityEvaluation(id, lotId, recipientOrganizationId, eligible, reasonCodes JSON, matchScore Decimal?, scoreBreakdown JSON, distanceKm?, routeProvider, evaluatedAt, policyVersion)`
`Offer(id, lotId, recipientOrganizationId, status, sentAt, expiresAt, acceptedAt?, unique(lotId,recipientOrganizationId))`
`Pickup(id, lotId unique, recipientOrganizationId, dispatcherUserId?, pickupStart, pickupEnd, scheduledAt?, arrivedAt?, completedAt?, status, failureReason?)`
`Handover(id, pickupId unique, donorActorId, receiverActorId?, verifiedQuantityValue Decimal, verifiedQuantityUnit, verifiedWeightKg Decimal?, codeHash, codeExpiresAt, verifiedAt?, receiptReference?, verificationMethod, status)`
`HandoverAttempt(id, handoverId, actorId, successful, reasonCode, timestamp)`
`AuditEvent(id, actorId?, organizationId?, entityType, entityId, action, oldState?, newState?, metadata JSON, createdAt, correlationId)`
`Notification(id, userId, kind, payload JSON, seenAt?, createdAt)`
Use server-set createdAt, foreign keys, strict DB constraints, appropriate indexes for status/window/tenant queries. Use Decimal for quantities; prohibit negative/zero input. Do not treat meals and kg as interchangeable; never fabricate conversion factors. In production avoid storing OTP in plaintext, and redact codes from logs.

## EXPLAINABLE MATCHING CONTRACT

Hard filters in this order: verified recipient; accepted category/handling capability; non-expired lot; recipient has enough declared capacity in matching units; geographically eligible if reliable coordinates exist; pickup availability intersects lot window. Missing critical capacity or availability → not eligible until completed. Missing precise coordinates → exclude distance scoring and mark 'distance not assessed'; choose a conservative explicit policy, do not invent distance.
Score only eligible recipients, default 100-point weighted rubric: capacity fit 35, pickup window overlap/feasibility 35, distance 30. Normalize each component to [0,1]; if distance is unavailable, reweight only available components and show score basis. Include versioned explanation `{eligible, reasonCodes, factors, score, policyVersion, computedAt}`. The donor sees recommendations, not fabricated precision. No model output is allowed to override hard filters.
Distance: for local demo, calculate Haversine from provided coordinates and label straight-line distance; never describe that as road/ETA. Route time requires an actual routing provider or explicit unavailable state. No automatic route optimization in P0.
Expiry and acceptance: transaction/row-lock or conditional update at database level plus a unique partial reservation invariant or equivalent serializable semantics. Handle conflicts with HTTP 409 and actionable UI. Idempotency keys on acceptance and verification; code cannot be replayed.

## AI-ASSISTED FEATURES (NOT SAFETY AUTHORITY)

- A contextual, read-only assistant summarizing open lots, why a recipient is ranked, upcoming deadlines and missing record fields.
- Supply assistant only retrieved, authorized facts; treat lot descriptions and uploaded text as untrusted input.
- Structured output schema with factual citations to lot/evaluation/pickup IDs, no hallucinated measurements, locations, or pickups.
- An LLM API key is optional. Implement zero-key deterministic templated summaries to keep MVP functional.
- AI cannot mark food safe, edible, donated, collected or delivered; cannot accept, verify, reroute or cancel without explicit authorized actions and deterministic server checks.
- Sensitive data minimization, output validation, request quotas and timeout/error fallback.

## CORE API CONTRACT

Use authenticated, versioned `/api/v1` endpoints with zod or equivalent validation and consistent `{data,error,meta}` response envelopes.
POST /auth/... (as framework requires)
GET /me, GET /organizations/me
GET /admin/organizations?status=pending, POST /admin/organizations/:id/verify, POST /admin/organizations/:id/suspend
GET /lots, POST /lots, GET /lots/:id, PATCH /lots/:id, POST /lots/:id/publish, POST /lots/:id/cancel
POST /lots/:id/matches/evaluate, GET /lots/:id/matches
POST /lots/:id/offers, GET /offers, POST /offers/:id/accept, POST /offers/:id/decline
GET /pickups, GET /pickups/:id, POST /pickups/:id/schedule, POST /pickups/:id/assign, POST /pickups/:id/status
POST /pickups/:id/handover/challenge, POST /pickups/:id/handover/verify, GET /pickups/:id/receipt
GET /impact/summary, GET /impact/handovers, GET /audit-events (authorized scope)
POST /assistant/explain (optional)
For every mutation: role check, tenant scoping, resource and state checks, request validation, audit logging, structured errors. Pagination and deterministic sorting for list APIs. Return 401/403/404/409/422 appropriately. Never reveal whether private third-party entity IDs exist.

## APP ROUTES AND PAGE SPECIFICATIONS

Public: `/` product overview; `/login`; `/register`; `/privacy`; `/terms` (draft, clearly not legal advice).
Onboarding: `/onboarding/organization` collects organization info + selected role; status page makes verification visible.
Donor: `/app/dashboard` with OPEN LOTS, ACCEPTED TODAY, HANDOVERS, urgent expirations, work queue; `/app/lots`, `/app/lots/new`, `/app/lots/[id]`, `/app/matches/[lotId]`, `/app/pickups`, `/app/impact`, `/app/settings`.
Recipient: `/app/opportunities`, `/app/offers`, `/app/received`, `/app/profile` with declared capacity and location preferences.
Dispatcher: `/app/dispatch`, `/app/dispatch/[pickupId]` mobile-first card with arrival, handover and status actions.
Admin: `/admin`, `/admin/organizations`, `/admin/audit`, `/admin/disputes` (P1 if not implemented).
Shared design: sidebar, top bar, search/filter/table states, role-aware navigation, notifications, form validation, status badges and accessible dialogs. Responsive widths 375px/768px/1440px, keyboard navigable, proper labels and focus indication; WCAG 2.2 AA target.
Design inspiration from uploaded portfolio page 25: operational sidebar [Surplus Lots, Matches, Pickups, Impact, Partners], KPI cards, work queue, right-side context assistant. Improve polish without losing task clarity. Visual language: restrained navy, warm amber, light neutral surfaces, one teal secondary accent; professional typography, subtle borders, meaningful iconography. No meaningless fake charts, fake real-time map, or unrelated stock hero photos.

## SYSTEM ARCHITECTURE AND CODE ORGANIZATION

Default: one Next.js TypeScript repository, App Router, server actions or route handlers with distinct services; PostgreSQL + Prisma, Auth.js, Tailwind/shadcn, Zod, Vitest, Playwright. Docker Compose for local PostgreSQL. Use dependency inversion for routing, notifications and LLM adapters. If existing repo has coherent alternatives, document before changing them.
Recommended:

```
src/app/(public)/...
src/app/(authenticated)/...
src/app/api/v1/...
src/components/{ui,layout,lots,matches,pickups,impact}/...
src/server/{auth,authorization,repositories,services,matching,state-machines,audit}/...
src/lib/{schemas,errors,utils,time}/...
prisma/{schema.prisma,seed.ts,migrations/...}
tests/{unit,integration,e2e}/...
docs/...
.github/workflows/ci.yml
Dockerfile
docker-compose.yml
.env.example
```

Avoid mixing business logic into React components. Domain service owns all transitions; database enforces invariants. Use event records/outbox where appropriate for reliable notifications; don't require a queue for a small MVP.

## SECURITY, PRIVACY AND SAFETY

- Authentication: secure sessions, password hashing if password login, verified email where available; production-safe cookie attributes, CSRF defense where relevant.
- RBAC + tenant isolation on every query/mutation; test horizontal and vertical privilege escalation.
- Input limits, API rate limits on login, matching, acceptance, OTP generation and OTP verification; lockouts and bounded retries; generic auth failure messages.
- No sensitive contact information in public responses. Token/codes salted/hashed, short-lived, one-time and not logged. Hash/rotate secrets appropriately.
- Secure headers, CORS restricted if applicable, parameterized DB operations, output escaping, strict file upload rules if later added.
- Error handling with correlation IDs; no secrets, stacks or PII in browser errors. Protect admin routes.
- Food safety: collect handling declarations, display disclaimers, no automated edibility/shelf-life or food safety certifications. Operators are responsible for suitability, labeling, safe handling, and local compliance; block obviously incomplete declarations but do NOT assert physical safety.
- Track separate lot-listed quantity, accepted quantity and verified handed-over quantity. For partial handover, support confirmed actual quantity <= reserved quantity, with discrepancy reason. Do not count more than actual verified quantity.
- Retention/deletion policies and legal privacy terms are pilot-dependent; surface as tasks, don't invent approval.

## ANALYTICS / IMPACT INVARIANTS

Metrics: `openLots`, `acceptedToday`, `verifiedHandovers`, `lotsCollected`, `verifiedKgDiverted`, `verifiedMeals`, `medianListingToAcceptanceMinutes`, `expiredLots`, `failedPickups`.
All computed by tenant scope and from actual database events (no hard-coded stats). `verifiedKgDiverted` sums verifiedWeightKg only when supplied and verified; `verifiedMeals` counts verified quantities with MEAL unit only. Never sum KG, ITEM and MEAL into a single unit. Include reporting period and provenance. Demo data must be visibly labeled as demo.

## TEST PLAN (MINIMUM)

Unit: field validation; matching hard filters; score normalization; unknown distance; timezone and expiry boundary; transition rules; impact aggregation by unit.
Integration: user / org authorization; verify org; publish lot; accept offer; concurrent accept with two recipient accounts; expired acceptance fails; OTP challenge and replay fail; cancellation/failure doesn't contribute to impact; audit event integrity; partial quantity <= offered; admin privilege protection.
E2E Playwright: admin approves donor and recipient; donor creates 25 meals for 90-minute window; system shows eligible recipient and reasons; recipient accepts; dispatcher scheduled; donor and receiver complete OTP handover; dashboard impact reflects exactly 25 confirmed meals. Separate paths for expiry, unverified org, wrong/expired OTP, conflicting acceptances, and recipient with insufficient capacity.
Quality gates: formatting, lint, TypeScript build, migration check, unit/integration/e2e tests, production build, dependency/security audit. Record commands and actual results.

## SEED AND DEMO SCRIPT

Create explicitly fictional demo identities and organizations (a campus cafeteria donor; two NGOs with varying capacity; a dispatcher; admin). Seed multiple lots: 25 packaged meals with a 90-minute pickup window, 12 kg bakery items, a soon-expiring lot, a fully expired lot, and an incompatible capacity case. Derive times from runtime rather than fixed old calendar dates. Use synthetic contact details and valid seeded passwords only in local demo instructions, never in deployed production.
Scenario A: a complete handover with actor and timestamp trail; no manual database edits.
Scenario B: two simultaneous acceptance requests; only one succeeds.
Scenario C: expired lot never appears in donated totals.
Scenario D: the assistant responds without an AI API key with fact-grounded summary.

## DEVELOPMENT PHASES AND EXIT CRITERIA

0 — REPO DISCOVERY: inspect code, dependencies and constraints; record plan and architectural decisions.
1 — FOUNDATION: Next.js, database, migrations, auth, tenancy, seed, local commands. Exit: login and DB functional.
2 — CORE DONATION: onboarding, verification, lot creation/publish, listing and detail. Exit: persisted donor workflow.
3 — MATCHING: eligibility checks, explainable scores and offer generation. Exit: verified recipient suggestions and disqualifications test.
4 — RESERVATION: transactional atomic offer acceptance, competing recipient conflict and expiry workers/reconciliation. Exit: 1 winning recipient in concurrency test.
5 — DISPATCH + HANDOVER: pickup scheduling, dispatcher experience, challenge generation/verification, idempotent completion. Exit: completed confirmed pickup after valid two-party action.
6 — ANALYTICS + AUDIT: verified-only metrics, event trails, responsive dashboards. Exit: actual ledger-derived summary and negative-case proof.
7 — OPTIONAL AI: read-only explanation + deterministic fallback. Exit: same basic demo with API key absent.
8 — HARDENING: automated testing, accessibility checks, monitoring, Docker, CI, docs, reproducible demo. Exit: all gates green, precise limitations documented.
9 — PILOT ROADMAP: separate backlog for P1/P2; do not hold P0 hostage to billing, live maps, bulk integrations, mobile native app or speculative 'agent' complexity.

## DOCUMENTATION TO CREATE AND KEEP CURRENT

- `README.md`: product purpose, features, screenshots captured from actual app, requirements, quick start, env vars, seeded logins, test commands, architecture, known limitations.
- `AGENTS.md`: Codex project instructions and verification checklist.
- `docs/PRD.md`: P0/P1/P2 scope, user stories, acceptance criteria, explicitly labeled assumptions.
- `docs/ARCHITECTURE.md`: components, dependency boundaries, security model, data flows, alternatives.
- `docs/DATABASE.md`: ERD (Mermaid), constraints/indexes, migration instructions.
- `docs/API.md`: sample requests/responses, errors, auth matrix.
- `docs/STATE_MACHINES.md`: Mermaid lifecycle and negative transitions.
- `docs/MATCHING_ENGINE.md`: scoring/filter specification, explanations and tests.
- `docs/SECURITY.md`: RBAC, secrets, threats, multi-tenancy, OTP protections.
- `docs/TEST_PLAN.md` and `docs/QA_REPORT.md`: coverage, failure scenarios, actual commands/results.
- `docs/DEPLOYMENT.md`: local Docker + one practical target platform, env, backups, rollback, healthchecks.
- `docs/DEMO_SCRIPT.md`: 4-minute product walkthrough, actors, scenarios and sample records.
- `docs/PROGRESS.md`: running phase checklist, blockers and tested functionality.
- `docs/DECISIONS.md`: ADR-style decision log.
- `docs/COMMERCIAL_ROADMAP.md`: pilot scope, monetization hypotheses, 90-day plan without unverified market claims.
- `.github/workflows/ci.yml`: lint, typecheck, tests, build.
- `.env.example`, `LICENSE` placeholder needing owner approval, appropriate Git ignore.

## AGENT SKILLS / RULES FILES

Generate `/skills/product-domain/SKILL.md`, `/skills/backend-data/SKILL.md`, `/skills/frontend-ux/SKILL.md`, `/skills/ai-matching/SKILL.md`, `/skills/security-qa/SKILL.md`, `/skills/devops-release/SKILL.md`.
Each skill must include: when to use, responsibilities, source files, invariants, implementation steps, tests and definition of done. Generate `AGENTS.md` as top-level binding rules. Do not fabricate installed external skills; treat these as repo-local authoring guidance.

## DEFINITION OF DONE / FINAL RESPONSE EXPECTATIONS

Accept only if a fresh-clone developer can launch DB, apply schema, seed, run app and complete the verified donation without editing code; protected API returns 403 or masked 404 to unauthorized users; all major operations have business and UI tests; code has no unimplemented dummy buttons; real screenshot(s) show tested UI; all migrations tracked; docs list every env setting and build command; tests/build outcomes accurately reported. If external deployment is unavailable, give reproducible steps and honestly mark remote deployment pending.

Final Codex response must include:

1. Implemented features by P0/P1/P2.
2. Files and architectural highlights.
3. Setup and demo commands (actually validated).
4. Tests run with counts, passes/failures and outstanding blockers.
5. Known security/product limitations.
6. Screenshots locations and deployment link ONLY if real and verified.
7. Suggested next commit/deployment steps; do not push/deploy or incur costs without authorization.

## START NOW

Start by inspecting the current repository, then create the plan and requirements checklist. Proceed through phases 1–8, actually implement and verify P0. If a tool is missing or an external service is not configured, provide a local working fallback and continue. Do not stop at planning. Never invent successful execution or product outcomes.
