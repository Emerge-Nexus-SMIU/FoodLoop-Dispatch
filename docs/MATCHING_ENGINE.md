# Explainable matching

Implementation: `src/server/matching.ts`, persisted evaluations in `EligibilityEvaluation`. Policy version `rules-v1.0`.

Hard filters: verified recipient, compatible category/handling, non-expired lot, sufficient capacity in the exact same unit, service radius when both points are supplied, and positive availability/window intersection. Missing profile or availability is ineligible. Matching never certifies food safety. Recipient capacity means a declared maximum per lot; no daily inventory forecast is implied.

Eligible-only score components:

- Capacity fit = quantity / capacity, clamped to [0,1], weight 35.
- Window fit = overlap / remaining lot window, clamped to [0,1], weight 35.
- Distance fit = 1 − Haversine km / service radius, clamped to [0,1], weight 30.

Final score is rounded 100 × weighted sum / available weights. Missing either point omits distance and divides by 70. Supplied coordinates are treated as human-declared points, not GPS-certified data. Haversine is labeled straight-line; no road ETA is fabricated.

Each evaluation stores eligible, ordered reason codes, factor breakdown, score/null, optional distance, timestamp and policy version. Donors can review eligible recommendations and exclusions. Recipient offers are scoped to their organization; acceptance recomputes eligibility from current declarations inside the reservation transaction, preventing stale evaluations from authorizing collection.

Tests cover every hard filter, exact expiry, absent coordinates, normalization, unit mismatch, geographic radius and timezone-offset equivalence. No LLM output influences matching or acceptance.

Administrators can publish validated, versioned nonnegative weights totaling 100, with a non-distance component required. Each stored factor breakdown records its actual weights; old evaluations keep their policy version. Hard eligibility cannot be overridden by weights. Default policy remains 35/35/30.
