# Deployment and operations

## Local development

Follow README quick start. PostgreSQL 18, Node 24 LTS. Docker Compose provides DB, a build-stage migration job and a non-root standalone web service. The optional embedded-postgres package is for development only; production uses managed/external PostgreSQL. `npm run db:migrate` is repeatable and never resets data.

## Practical target: single Docker host + managed PostgreSQL

This target is documented, not remotely deployed. Provision hosting only after owner authorization.

1. Build the Docker image in CI from a reviewed commit. Set DATABASE_URL via host secret manager and APP_ORIGIN to the exact HTTPS origin. Disable/omit ALLOW_DEMO_SEED. Use a dedicated restricted runtime DB role and separate migration credentials.
2. Take a backup, run `npm run db:migrate` using the build image as a one-shot release job. Do not run destructive schema reset. Bootstrap the first admin through `npm run admin:create` with securely injected ADMIN_* values, then remove them.
3. Run the runner image behind an HTTPS reverse proxy. Publish only the proxy; keep DB private. Verify `/api/health`, login/logout and an isolated staging donation workflow. Add ingress TLS/HSTS, request limits and appropriate timeouts.
4. Schedule `npm run reconcile` every minute using a maintenance image/job. Every mutation also enforces expiry, so worker delay cannot make an expired lot acceptable.
5. Monitor health, HTTP error/429 rate, pickup failures, expired lots and backup age. Structured internal logs contain correlation IDs without proof values. Configure centralized logging/alerts before a real pilot.

## Backups and rollback

Take encrypted daily database backups and a pre-migration backup; validate restoration in isolated staging. Retention and residency require owner/legal policy. Keep previous application image digest. Roll back the app only if compatible with the applied schema; prefer additive forward migrations. Never roll back by deleting audit/receipt history. A database restore loses subsequent events and requires explicit incident handling. No destructive rollback script is provided.

## Environment constraints / evidence

See QA_REPORT for actual image build/runtime results. Source build and local process validation do not prove a remote deployment works. No public link, DNS, SSL certificate, billing account or managed database was created.

## Commercial-hardening operations

Before a public release, provision a fresh database and distinct migration/runtime roles. Apply both tracked migrations with migration credentials, then use scripts/runtime-role.sql as the restricted-role grant recipe. Do not use the local Compose superuser as the production runtime credential.

Set AUTH_ENCRYPTION_KEY via secret manager, a real verified Resend sender/credential, exact HTTPS APP_ORIGIN, PK operating context, real SUPPORT_EMAIL and registered BUSINESS_NAME. Owner/legal policy inputs are explicit and must not be asserted merely to make a checker green. Run `npm run release:check` with production runtime credentials; inspect every issue. `/api/health` is connectivity; public `/api/ready` is a separate configuration/database gate. Even technical readiness still requires actual delivery proof, reviewed terms/license, independent review and operational sign-off.

Run `npm run worker` as a separately supervised process using the same encryption key and database. It delivers encrypted outbox jobs, reconciles expiry and cleans expired security state. File transport is local-development only; do not claim emails reached an external inbox when files were written. Alert on FAILED mail, growing pending counts, expired backlog, readiness failures and backup age; admin operational counters are based on actual database records.

Bootstrap a real administrator with the secure CLI, verify its email and enroll an authenticator before granting production administration. Demo accounts are blocked publicly. ALLOW_DEMO_LOGIN is a loopback-only local fixture mode and never passes the public release gate. Do not point integration/browser tests at production; fixture guards enforce local targets and force file mail.

A full online Dockerfile build, containerized application against fresh PostgreSQL 18, a 25-meal API smoke test, encrypted local backup/restore rehearsal and restricted-role mutation tests were performed during commercial review. See QA_REPORT.md for exact scope. This is not evidence of a remotely deployed or independently certified production environment.
