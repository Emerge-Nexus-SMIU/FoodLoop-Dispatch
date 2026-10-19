# Product requirements

The authoritative contract is [MASTER_SPEC.md](MASTER_SPEC.md). FoodLoop coordinates declared surplus between manually verified organizations; it never determines physical food safety.

## P0 product

Four roles: platform administrator, donor manager, recipient manager and assigned dispatcher. An account onboards one organization; email-bound multi-member invitations are implemented; cross-organization account switching remains deferred. Admin approval enables donation and reservation. Donors maintain drafts and publish time-bounded lots; recipients declare per-lot capacity, compatible categories/handling, geography and explicit availability. Rules produce exclusions and scored recommendations. One eligible recipient reserves a lot atomically. Donor schedules and assigns a verified dispatcher. Dispatcher records en route and arrival. Donor declares actual quantity and issues a five-minute challenge; receiver or assigned dispatcher consumes it, and donor finalizes the receipt. Reports count verified receipts only. All material transitions append audits.

## Acceptance criteria

US01–US10 map to TRACEABILITY.md and integration/browser suites. Negative cases must reject cross-tenant access, expired reservations, competing acceptances, invalid/replayed codes, excess quantity, unverified organizations and illegal state shortcuts. Metrics must separate units and exclude failed/canceled/expired lots. Assistant replies cite authorized record IDs and do not change state.

## Explicit assumptions and conservative decisions

- Single organization per self-registered account in P0; platform admin is provisioned separately.
- Capacity is a maximum per lot, not a rolling daily inventory commitment. No cross-lot allocation promise is made.
- Missing coordinates omit distance scoring and reweight capacity/window; reliable supplied coordinates enforce service radius. Road time is unavailable.
- Availability is a declared absolute interval, not a weekly recurrence rule.
- Published lots are immutable except validated cancellation; correction requires a fresh lot.
- No withdrawal/reopening flow; failed/canceled/expired lots never return to OPEN.
- Email verification, account recovery, authenticator MFA, inbox, session controls and an email adapter are implemented. Real sender configuration/delivery and approved retention/legal policy remain launch gates.
- P0 proof uses six-digit OTP; no camera or QR dependency.

## Later scope

P1: invitations, account recovery/email verification, settings editing, inbox/email delivery, CSV export, recurring availability, capacity allocation, route providers, observability and reporting scale. P2: billing, validated sustainability methodology, integrations, localization and route optimization. Pricing in the source is a hypothesis, never an implemented billing commitment.

Initial market is Pakistan; product attribution is A product of Emerge Nexus. Exact registered entity and support address await owner confirmation. See PAKISTAN_LAUNCH.md.
