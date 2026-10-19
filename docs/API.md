# API v1

Base `/api/v1`. JSON envelope: `{data, error: null, meta: {correlationId, offset, limit}}`; failures `{data:null,error:{code,message},meta:{correlationId}}`. Decimal quantities serialize as strings in persisted records. Server timestamps are ISO UTC.

Authentication uses `foodloop_session` cookie. Send `Origin` equal to APP_ORIGIN on POST/PATCH, `Content-Type: application/json`, and a unique `Idempotency-Key` (8–120 chars) for acceptance, receiver verification and donor finalization. Reusing a successful key for its same operation returns the existing result; a key cannot authorize a different resource/action. Retry a failed OTP using a new key. The server never returns another tenant's private resource existence.

| Endpoint                                | Method      | Authorized caller / result                                                           |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| auth/register                           | POST        | name, email, password (12+ chars); account only, cannot select admin                 |
| auth/login, auth/logout                 | POST        | credential login / authenticated logout                                              |
| me                                      | GET         | current identity, memberships and own organization                                   |
| organizations                           | POST        | account without membership; pending organization + collection point                  |
| organizations/me                        | GET         | own org/profile/locations; admin sees all                                            |
| admin/organizations                     | GET         | admin only                                                                           |
| admin/organizations/:id/verify, suspend | POST        | admin; audited state change                                                          |
| recipient-profile                       | PATCH       | recipient manager; own profile only                                                  |
| lots                                    | GET / POST  | authorized list / verified donor creates draft                                       |
| lots/:id                                | GET / PATCH | scoped read / own draft edit                                                         |
| lots/:id/publish, cancel                | POST        | own donor; validated transition                                                      |
| lots/:id/matches                        | GET         | own donor; latest stored evaluations                                                 |
| lots/:id/matches/evaluate               | POST        | own donor; current persisted evaluation                                              |
| lots/:id/offers                         | POST        | own verified donor; send offers to eligible recipients                               |
| offers                                  | GET         | recipient's offers / admin                                                           |
| offers/:id/accept, decline              | POST        | verified owning recipient; acceptance atomic and idempotent                          |
| dispatchers                             | GET         | donor; verified dispatcher IDs/names only                                            |
| pickups, pickups/:id                    | GET         | donor, owning recipient, assigned dispatcher, admin                                  |
| pickups/:id/schedule                    | POST        | donor; `{scheduledAt}` inside collection window                                      |
| pickups/:id/assign                      | POST        | donor; `{dispatcherUserId}` after scheduling                                         |
| pickups/:id/status                      | POST        | assigned dispatcher progresses transit; donor/dispatcher can fail/cancel with reason |
| pickups/:id/handover/challenge          | POST        | donor after arrival; `{quantity,weightKg?,discrepancyReason?}`                       |
| pickups/:id/handover/verify             | POST        | recipient or assigned dispatcher; `{code}` consumes one-time proof                   |
| pickups/:id/handover/confirm            | POST        | donor finalizes receipt after distinct receiver confirmation                         |
| pickups/:id/receipt                     | GET         | authorized parties; verified receipts only                                           |
| impact/summary, impact/handovers        | GET         | authorized scope, verified actual quantities only                                    |
| audit-events                            | GET         | admin all; others own org/actor                                                      |
| assistant/explain                       | POST        | authorized stored facts; deterministic zero-key summary                              |

`GET /api/health` is unauthenticated and checks database connectivity without revealing details. Mutations reject malformed JSON, oversized bodies and invalid enums. 401 sign-in required; 403 wrong role/origin/unverified org; 404 masked missing/private; 409 state/conflict/expiry; 422 field validation/wrong proof; 429 rate/attempt limit. No stack traces or OTP hashes in API responses.

List endpoints lots/offers/pickups/audit support `?offset=0` in deterministic batches of 50. Organization/dispatcher directory is bounded to 100 for this MVP. Impact/handovers is a verified subset of the current pickup page; use summary for full-ledger totals. Large-network cursor pagination and SQL reporting are P1 scalability work.

## Representative workflow payloads

```json
{
  "title": "Packed campus meals",
  "category": "PREPARED",
  "quantityValue": 25,
  "quantityUnit": "MEAL",
  "locationId": "YOUR_LOCATION_ID",
  "packaging": "Sealed trays",
  "handlingDeclaration": "Operator declares labeled containers held for collection",
  "storageRequirements": "AMBIENT",
  "pickupStart": "2026-10-19T12:00:00Z",
  "pickupEnd": "2026-10-19T13:30:00Z"
}
```

Times above illustrate shape; send current/future instants when actually executing. Publish, evaluate and send offers with empty JSON objects. Recipient accepts its own offer with a fresh idempotency key. The acceptance response supplies pickup ID. After scheduled/assigned/en-route/arrived, challenge returns `{code,expiresAt}` only to the donor; share directly with receiving party. Receiver verify returns `{receiverConfirmed:true}`. Donor confirm returns `{receiptReference}`. No metric increments between challenge and donor confirmation.

Impact summary additionally returns separate `listedQuantities`, `acceptedQuantities` and `verifiedQuantities` objects by MEAL/KG/ITEM. These are distinct stages, not interchangeable donation claims.

## Commercial-hardening API additions

All paths below remain under /api/v1 and use the shared envelope, Origin guard and private error responses.

| Endpoint                            | Method      | Scope and purpose                                                                            |
| ----------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| auth/forgot-password                | POST        | generic response, queues reset link if eligible                                              |
| auth/reset-password                 | POST        | token + new password; consumes once and revokes sessions                                     |
| auth/verify-email                   | POST        | one-time verification token                                                                  |
| account/verification                | POST        | resend own verification link                                                                 |
| account/password                    | POST        | currentPassword + newPassword; revoke sessions                                               |
| account/sessions                    | GET         | own active sessions, current marker                                                          |
| account/sessions/revoke             | POST        | own session ID, or all own sessions                                                          |
| account/mfa/setup                   | POST        | password confirmation; one-time enrollment secret                                            |
| account/mfa/enable                  | POST        | code confirmation; returns one-time recovery codes                                           |
| account/mfa/disable                 | POST        | password + authenticator/recovery proof; revoke sessions                                     |
| organization/settings               | PATCH       | manager's own name/contact/timezone/collection address; name change requests re-verification |
| organization/members                | GET         | manager's own team and pending invites                                                       |
| organization/invitations            | POST        | scoped email/role invitation                                                                 |
| organization/invitations/:id/revoke | POST        | own pending invitation only                                                                  |
| invitations/accept                  | POST        | token bound to own verified email                                                            |
| organization/members/:id/remove     | POST        | own org only; preserve last manager, revoke removed member sessions                          |
| notifications                       | GET         | own inbox; offset pagination and unread count                                                |
| notifications/read                  | POST        | own notification ID or all own unread                                                        |
| pickups/batch-assign                | POST        | up to 25 IDs + dispatcher; independently authorized per-record results                       |
| disputes                            | GET / POST  | own organization list / authorized pickup issue                                              |
| admin/disputes/:id/resolve          | POST        | admin resolution; immutable receipt untouched                                                |
| admin/policy                        | GET / PATCH | admin versioned nonnegative weights totaling 100                                             |
| admin/operations                    | GET         | mail-state counts, verification counts, failed pickups and expiry backlog                    |
| exports/impact                      | GET         | tenant-scoped verified receipt CSV, at most 10000 rows                                       |
| exports/audit                       | GET         | scoped audit CSV, at most 10000 rows                                                         |

Exports return text/csv with Content-Disposition and no-store; formula-leading text is neutralized. Exports above their bound return 422 instead of silently omitting rows. Organization lists now paginate at 50 with optional admin status filter. Batch results explicitly report successes/failures; there is no fake all-or-nothing success. `impact/handovers` pages verified records rather than filtering an already-truncated mixed-state page.

`GET /api/ready` is separate from connectivity health: development/loopback fixtures return demo_only with commercialRelease:false. Incomplete public production returns 503 without exposing private configuration details. Use the operator-only release:check command for issue codes.
