# Security model and release gates

## Implemented controls

- bcrypt cost 12; new/reset/changed passwords require 12 characters and at most 72 UTF-8 bytes to prevent silent bcrypt truncation. Login failures are generic.
- Random 256-bit eight-hour sessions are stored hashed; HttpOnly/SameSite=Lax, Secure in production. Users can inspect/revoke sessions; password changes/resets revoke all sessions. Member removal also revokes the removed user's sessions.
- Email verification and recovery use random tokens stored only as hashes, server-enforced expiry, conditional one-time consumption, and durable audits. Recovery invalidates remaining reset links and does not remove MFA.
- Authenticator secrets and mail payloads use randomized AES-256-GCM with a separately configured AUTH_ENCRYPTION_KEY. RFC 6238 vectors are tested. TOTP counters reject replay; recovery codes are hashed and atomically consumed, including competing requests. MFA enrollment revokes other sessions. Production platform administration requires verified email and MFA, including shared data APIs, not just /admin URLs.
- Public production blocks fixture identities, including the demo admin without an organization membership. An explicit loopback-only demo mode is separate and never passes the public release gate.
- Exact configured Origin on mutations, bounded streaming JSON reads, Zod field/enum limits, parameterized database access, private correlation-ID error envelopes and no code/token/secret logging.
- Per-user/email/action rate limits and shared auth/action caps, bounded OTP attempts, short challenge lifetime and replay protection. See implementation for current limits; global limits are also a resource bound, not an alternative to ingress abuse protection.
- Tenant predicates and role checks on all resource actions; masked 404 for unrelated private IDs. Dispatcher sees only assigned pickups. Settings, invitations, sessions, notifications, disputes and exports are scoped server-side.
- Invites bind the verified recipient email, role, organization, expiry and one-time token; each account currently belongs to one organization. The last manager cannot be removed. Changing verified organization identity requires re-verification and is blocked during active donations.
- Serializable conditional reservation with partial unique accepted-offer index and unique pickup. Actor/operation/resource-bound idempotency. Pickup windows and recipient availability are enforced, including before-window proof rejection.
- Salted one-time pickup code after arrival, receiver consumption and distinct donor final confirmation. Actual quantity cannot exceed reserved quantity; partial quantities need a reason. Only final immutable receipt increments unit-separated impact.
- Nonce-based production script/style CSP, no production unsafe-inline/eval, frame denial, nosniff, same-origin referrer policy and permission restrictions. HSTS is emitted for HTTPS pages; configure ingress consistently.
- Append-only audit and immutable verified receipt triggers; restricted runtime-role grant recipe; non-root Docker runtime. Runtime must not own schema or have superuser rights.

## Mail and privacy boundaries

File mail transport is development-only and writes ignored, private `.local/mail` files; it does not deliver to an external inbox. Production adapter uses an explicitly configured verified Resend sender, request timeout, per-message provider idempotency, leases and retry/backoff. Sent means provider acceptance, not proven inbox delivery. Real delivery remains an owner/provider gate. Mail payloads are redacted after successful delivery. Never export private mailbox files, traces, encryption keys or database fixtures in source archives.

Names, addresses, member emails, audit actors and declared receiving profiles are operational personal data. Organization managers see their own team contacts; recipients do not receive unrelated partner contacts. Audit exports respect the same scope and guard CSV formula injection. Bounded exports fail rather than silently truncate. Account-action links must be excluded from access logs and support screenshots; local automated artifacts use only fictional identities.

## Verified versus outstanding

Automated negative cases cover tenant/role escalation, origin/body limits, races, expiry, replay, wrong/locked proof, MFA/recovery concurrency, session ownership, stale eligibility and identity-change approval. Automated axe checks cover representative public/legal/account pages and focus visibility; they are not full manual accessibility certification.

Independent penetration/load review, production ingress controls, ongoing dependency monitoring, encryption-key rotation procedures, real sender delivery proof, restricted production credentials, offsite backups/restore sign-off and owner-approved Pakistan privacy/retention/license terms remain launch work. The release checker reports NO_GO until required configuration is present; even a clean technical configuration does not invent the manual approvals. Local backup/restore and restricted-role rehearsals are recorded in QA_REPORT.md.
