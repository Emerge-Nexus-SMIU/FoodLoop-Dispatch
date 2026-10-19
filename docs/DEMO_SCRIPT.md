# Four-minute demo

Use fictional fixtures and separate browser profiles/private windows. All fixture passwords: `DemoFoodLoop!2026`. Each role has an independent session.

1. **0:00 donor**: sign in as donor@demo.foodloop.test. Overview shows real ledger metrics and explicitly labeled fictional data. Create a new 25-MEAL lot, pickup now through +90 minutes, with packaging and handling declaration. Save draft, publish, evaluate matches. Show why the two 50-meal recipient profiles qualify; bakery KG and 500-meal examples demonstrate incompatible-unit/capacity exclusions.
2. **0:50 recipient**: donor sends eligible offers. Sign in as recipient@demo.foodloop.test, open Offers and accept the new lot. Another recipient cannot win it afterward. This is a reservation, not a donation.
3. **1:30 dispatch**: donor opens Pickups, schedules inside the window, assigns Bilal. Sign in as dispatcher@demo.foodloop.test; start collection and record arrival. Pickups show current state after navigation/refresh.
4. **2:15 two-party proof**: donor declares actual 25 meals and generates a code after arrival. Share it directly with recipient (not a public channel). Recipient enters it and confirms receipt of food. Donor refreshes Pickups and finalizes. Show immutable receipt, actor trail and exact 25 confirmed meals in Impact. No kg is invented.
5. **3:10 accountability**: administrator opens Audit ledger. Show failed/expired lots do not increase totals. Generate the Operations brief with no LLM API key; show record ID citations. At mobile width show dispatcher-friendly actions.

## Alternative scenarios

- Concurrent offers: integration/HTTP browser tests issue simultaneous requests; exactly one response succeeds and one gets 409.
- Expiry: expired seeded lot stays EXPIRED. New acceptance/finalization after end fails; reconciliation records expiration and fails unfinished pickup.
- Wrong OTP: one failure is logged; five failures lock the handover. Expired and replayed proofs cannot finalize donations.
- Partial handover: enter 20 of 25 with discrepancy reason; confirm both parties; impact increases only 20 MEAL and only an explicitly entered verified weight.
- Approval: create a fresh account/organization, observe pending status, approve through admin UI. No self-admin registration exists.

Seed preserves historical state. Rerun seed refreshes recipient availability but does not reopen expired fixture lots. Create a new lot for each repeated walkthrough.
