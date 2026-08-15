# Wave 5 completion definition of done

Baseline: `4f4273e` (merged PR #42). This document corrects the earlier
architecture wording: PR #42 delivered persistence and application primitives,
not a completed worker product.

## Exact completion-gap analysis

| Capability | PR #42 baseline | Completion-pass state |
| --- | --- | --- |
| Employer collaboration / responsibilities / task assignee | persistence only; no route or UI | authenticated collaboration read and manager responsibility mutation API; employer UI and task reassignment remain incomplete |
| Worker portal routes | missing | distinct mobile-first `/worker` shell and authenticated projection API |
| Worker authentication / authorization | access relation persisted, no worker auth boundary | authenticated user resolves an active access relation server-side; no browser case id is accepted |
| Invitation / activation | persistence only | hashed expiring token creation and atomic, single-use activation; delivery and production Supabase redirect configuration remain external |
| Payment projection / acknowledgement | application projection plus persistence | closed receipt API/UI and idempotent worker-only acknowledgement; canonical durable amount remains unavailable and is shown as unavailable |
| Vacation | projection only | safe history shell; no governed leave ledger exists, so no balance is fabricated |
| Worker requests / employer handling | persistence only | worker create/history and manager-validated state-transition APIs; full employer UI remains incomplete |
| Worker documents | visibility column only | worker list is explicitly visibility filtered; signed download route remains incomplete |
| Communication preferences | persistence/application only | worker status UX explains channel availability; preference mutation API remains incomplete |
| Notifications / Resend | orchestrator and adapter only | high-value event persistence wiring remains incomplete; Resend configuration is external |
| Timeline / audit | policy only | responsibility changes are audited; complete human Timeline coverage remains incomplete |
| Dashboard attention | missing | still missing |
| PostgreSQL RLS | table coverage present | worker bootstrap functions add a narrow trusted lookup; live harness must still be run with configured PostgreSQL |
| Playwright | missing | still missing for Wave 5 |

## Authorization architecture

Employer authority is derived from the authenticated tenant membership. Worker
authority is different: Supabase authenticates the identity, a narrow database
function finds candidate tenant contexts, and every product query then runs in a
transaction with the canonical `app.tenant_id` RLS context. The active
`worker_portal_access` row supplies case and caregiver identity; endpoints never
accept those identifiers from the worker.

Invitation tokens are random, stored only as SHA-256 digests, expire, and are
consumed under a row lock. Revoked, expired, consumed, or unknown tokens return
the same safe failure. Activation reuses Supabase identity and does not create a
second credential system.

## Consent and notification architecture

The canonical pipeline remains `trusted event → intent → consent/preferences →
localized template → provider → attempt`. Resend is the only email adapter.
WhatsApp and SMS remain disabled until an approved provider exists and explicit
consent is granted; the worker UI says they are unavailable rather than claiming
delivery. Provider retries must stay out of the human Timeline.

## Honest close decision

Wave 5 is **not ready to close**. Employer UI, preference writes, worker signed
document download, notification persistence wiring, complete audit/Timeline
events, real PostgreSQL evidence, required Playwright flows, and Vercel preview
evidence remain outstanding. CareDesk must not proceed to Wave 6 yet.

## Strategic capability status

1. Compliance Timeline — GREEN
2. Decision Dashboard — GREEN (Wave 5 ownership grouping is incomplete)
3. CareDesk Score — GREEN
4. Smart Documents — GREEN
5. Case-aware AI — ORANGE (provider/configuration dependent)
6. Monthly Close — GREEN
7. Family Collaboration — ORANGE
8. Worker Portal — ORANGE
9. Event Wizards — GREEN
10. Audit/Evidence Trail — GREEN (Wave 5 event coverage incomplete)
11. Regulation Engine — ORANGE
12. Future Cost — GREEN
13. WhatsApp-first engagement — RED
14. Human Escalation — ORANGE
15. Emergency Binder — RED
