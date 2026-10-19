# FoodLoop Dispatch

**A product of Emerge Nexus · Pakistan.** A multi-organization surplus-food coordination application with verified partners, explainable eligibility, exclusive reservations, pickup dispatch and two-party proof of actual handover. FoodLoop does not certify food safety.

**Commercial launch status: NO-GO pending owner/provider/operational gates.** This repository implements and tests the donation workflow and a commercial-hardening layer. A passing build is not legal approval, real email-delivery proof or proof that a future hosting environment is ready. Run `npm run release:check`; read [release readiness](docs/RELEASE_READINESS.md) and [Pakistan launch decisions](docs/PAKISTAN_LAUNCH.md).

## Implemented

- Password authentication, hashed opaque sessions, email verification, expiring one-time password recovery, password changes and session revocation.
- Authenticator MFA with encrypted secrets and one-time recovery codes. Production administrators require MFA; public deployments block fictional demo identities.
- Organization onboarding, manual verification/suspension, editable scoped settings and email-bound team invitations. Name changes require re-verification and are blocked while donations are active.
- Donor drafts/publishing/cancellation; recipient capacity/category/handling/availability declarations; persisted deterministic match explanations and configurable versioned weights.
- Serializable exclusive acceptance, expiry reconciliation, scheduling, dispatcher assignment, batch assignment with per-record outcomes, transit and arrival.
- Hashed short-lived handover code, receiver confirmation and separate donor finalization; bounded retries, expiry/replay protection and discrepancy reasons for partial quantities.
- PostgreSQL-aggregated, tenant-scoped quantities and metrics. MEAL, KG and ITEM stay separate; only verified actual quantities count as donations. Protected CSV exports refuse silent truncation.
- Durable notification inbox, encrypted email outbox with a Resend adapter and local development mailbox, admin operational counters and audited disputes that cannot rewrite verified receipts.
- Responsive role-aware UI, request nonces/CSP, bounded JSON body parsing, server-side tenant/role checks, append-only audits, immutable receipts, migrations, tests, CI and non-root Docker runtime.

## Setup guide and documentation

Start with the [detailed setup guide](docs/SETUP.md) for cloning, prerequisites, database setup, local email, demo accounts, troubleshooting and Docker instructions. Follow the [demo walkthrough](docs/DEMO_SCRIPT.md) to complete your first donation. Screenshots below are actual application captures.

## Start locally

Requirements: Node 24 LTS, npm, PostgreSQL 18 (Docker recommended).

```bash
npm ci
npm run dev:configure
npm run db:generate
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

`dev:configure` preserves existing `.env` values, creates a private random account-encryption key if missing and defaults the operating country to PK. It never prints keys. If Docker is unavailable, use `npm run db:local` in another terminal instead of starting the Docker database. That helper runs real PostgreSQL, retaining `.local/postgres`, and must remain running. Do not start two databases on port 5432.

For local account emails, run `npm run worker` in another terminal (or `npm run mail:deliver` for one batch). The development-only file transport writes private messages to ignored `.local/mail/*.json`; open your fictional account's verification/reset/invitation link there. Messages are not actually delivered to an external email inbox in file mode. `npm run worker:once` also reconciles expired windows and cleans expired security state.

Open the application on local port 3000. Use `localhost` consistently with APP_ORIGIN. For production-mode local validation, `npm run build` then `npm start`; fictional identities require explicit `ALLOW_DEMO_LOGIN=true` **and** a loopback APP_ORIGIN. This mode is not eligible for commercial release.

## Fictional demo identities

Seed password: `DemoFoodLoop!2026`. Never expose fixtures in a public deployment.

| Email                         | Role                         |
| ----------------------------- | ---------------------------- |
| admin@demo.foodloop.test      | Platform administrator       |
| donor@demo.foodloop.test      | Campus kitchen donor manager |
| recipient@demo.foodloop.test  | Community recipient manager  |
| recipient2@demo.foodloop.test | Second recipient manager     |
| dispatcher@demo.foodloop.test | Collection dispatcher        |

The seed requires ALLOW_DEMO_SEED=true outside production, verifies only its known fictional account emails, refreshes recipient availability, and preserves historical lots. It never reopens expired lots. Create a new lot for repeated walkthroughs. [Four-minute demo](docs/DEMO_SCRIPT.md).

## Docker

```bash
npm run dev:configure
docker compose up --build -d
docker compose run --rm -e ALLOW_DEMO_SEED=true migrate npm run db:seed
```

Compose is a **loopback-only local demo**: PostgreSQL, one-shot migration job, unprivileged web container and local mail/expiry worker. Web and worker receive the same private encryption key. File mailbox messages are in the `local_mail` volume. Public production uses a real mail sender, restricted database role, HTTPS, fresh database without fixtures and separate migration credentials. The optional BuildKit `proxy_ca` secret preserves TLS trust in proxy-managed build environments; verification is never disabled. [Deployment and rollback](docs/DEPLOYMENT.md).

## Configuration

| Setting                                   | Purpose                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DATABASE_URL                              | PostgreSQL URL; secret in real deployments                                                                                     |
| APP_ORIGIN                                | Exact origin for mutation CSRF checks; public production must use HTTPS                                                        |
| AUTH_ENCRYPTION_KEY                       | Private 32-byte hex key for authenticator/outbox encryption; generate locally with dev:configure, store securely in production |
| MAIL_TRANSPORT                            | file for development; resend for production adapter                                                                            |
| RESEND_API_KEY / MAIL_FROM                | Production provider credential and verified sender; no real sender is configured yet                                           |
| OPERATING_COUNTRY                         | PK for initial Pakistan release                                                                                                |
| SUPPORT_EMAIL / BUSINESS_NAME             | Owner must supply a real support address and exact registered entity name                                                      |
| LEGAL_APPROVED / RETENTION_DAYS           | Owner/legal approval and policy inputs; do not invent approval                                                                 |
| ALLOW_DEMO_SEED                           | Explicit local fictional fixtures only; omit in public production                                                              |
| ALLOW_DEMO_LOGIN                          | Explicit loopback demo access only; false in public production                                                                 |
| POSTGRES_PASSWORD                         | Compose local database credential; replace outside local development                                                           |
| PLAYWRIGHT_CHROMIUM_PATH                  | Optional installed Chromium path; otherwise use Playwright-managed browser                                                     |
| ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD | One-time bootstrap CLI values, password at least 16 characters; remove after use                                               |

Never put production secrets into Git. Back up the encryption key separately from the database and plan rotation; existing encrypted MFA/outbox data cannot be recovered without it. There is no LLM/routing/billing key requirement for the core charity workflow.

## Verification

Tests append fictional records and exercise expired windows/security tokens. Use a disposable local database with ALLOW_DEMO_SEED=true. Fixture guards reject external/production/pilot database targets and force file email transport.

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run build
npm audit --audit-level=high
# Complete API demo against the running local app, creates fictional records:
npm run smoke
# Expected NO_GO for a development fixture environment:
npm run release:check
```

Cloud Chromium command: `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`. `/api/health` checks connectivity; `/api/ready` separates demo/technical readiness and returns 503 for incomplete public production configuration. Actual test counts and observed failures/corrections are in [QA report](docs/QA_REPORT.md).

## Architecture and remaining scope

Next.js 16 / React 19 / TypeScript; Prisma 7 PostgreSQL JS driver; Zod; Vitest; Playwright/axe. The lockfile pins exact installed packages. Domain transitions live in `src/server/service.ts`; account, team/operations, mail, matching and release concerns have distinct service modules. Database constraints independently enforce reservation/receipt/audit invariants.

[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [Progress](docs/PROGRESS.md).

Real provider email delivery, an exact registered entity/support channel, approved legal/retention/license policy, production credentials, independent reviews and operational backup/restore sign-off remain release gates. Live road routing/ETA, route optimization, external integrations, recurring schedules, rolling capacity allocation, localization and P2 subscriptions/sustainability methodology are separately scoped extensions; no live billing is authorized. No remote deployment is claimed.

## Actual screenshots

![Desktop donor workspace](docs/screenshots/donor-dashboard.png)
![Mobile donor workspace](docs/screenshots/donor-mobile.png)

## License

All rights reserved pending owner approval. `LICENSE` intentionally grants no open-source license. Review third-party licenses before commercial distribution.
