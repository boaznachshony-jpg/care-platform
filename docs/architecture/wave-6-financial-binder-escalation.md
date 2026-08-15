# Wave 6 — financial planning, emergency binder and escalation

Baseline: `8b97556` (merged PR #44).

## Gap analysis

| Capability | Before | Gap | After this change |
| --- | --- | --- | --- |
| Future Cost | ORANGE | Monthly cards did not identify canonical closed payroll as actual, expose component provenance/status, reject unsafe values, or state a reserve calculation | GREEN for the local product: deterministic 12-month projection, actual/forecast/unknown component labels, three-month and annual totals, planning-only reserve guidance |
| Human Escalation | ORANGE | PR #44 provides authenticated creation/listing and durable tenant-isolated requests, but no provider is connected and lifecycle/package UI remains incomplete | ORANGE; the commercial boundary remains explicit and no provider activity is fabricated |
| Emergency Binder | RED | No configurable employment-file export | ORANGE: authenticated employer UI provides four presets, explicit section/document review, RTL print/PDF output, missing-value labels, and no public link; server-side/audited export is still required for GREEN |

## Future Cost methodology

The projection is deterministic and never calls AI. A closed payroll record replaces the forecast
for its month and is labelled `ACTUAL`. Future months repeat only the configured salary and stored
recurring expenses; stored dated expenses appear in their month. Missing salary is `UNKNOWN` and
contributes zero rather than being invented. All inputs must be finite and non-negative and monetary
results are rounded to two decimals. Scenario values are transient calculation inputs and do not
write payroll. The monthly reserve is annual projected cost divided by twelve and is planning
guidance, not financial advice. No ungoverned Israeli entitlement or statutory rate is inferred.

## Binder architecture and privacy

The binder route is inside the authenticated application shell and scoped by the selected client.
Presets only initialize checkboxes: the employer reviews them before output. Stored documents are
excluded until individually selected. The PDF-friendly HTML contains only a document index and
never renders an uploaded file as executable HTML. Payroll is visibly marked sensitive. Browser
print provides RTL A4 pagination and “Save as PDF”; it creates no public URL.

This client-side export is intentionally an interim boundary. It does **not** claim a durable export
audit, secure share, ZIP attachment bundle, access audit, or server-generated PDF. Those require an
authenticated API/export manifest, short-lived hash-backed share tokens, rate limiting and real
PostgreSQL RLS tests before Emergency Binder can be called fully GREEN.

## Human escalation commercial boundary

`ProfessionalReviewRequest` remains the canonical request. The product must say only that a case
requires professional review. It must not claim assignment, appointment, payment, or active review
until a contracted provider integration exists. A future review package must use the same explicit
section/document selection model and persist only manifest metadata, never duplicate case facts.

## 15-capability review

Capabilities 1–12 are GREEN per the existing completion evidence, except any production dependencies
already listed in `BUILD_STATUS.md`. 13 WhatsApp-first is RED and deliberately outside Wave 6. 14
Human Escalation is ORANGE pending lifecycle/package UI and a real provider. 15 Emergency Binder is
ORANGE pending server-side audited export and secure sharing. Wave 7 must not start production
integration until Wave 6 CI is green and these remaining boundaries are accepted.
