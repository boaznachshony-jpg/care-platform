# Wave 3 closure — canonical Product Intelligence

Status: **IMPLEMENTED; hosted verification pending**  
Baseline: `22b2ef94d949cd288c03c7fa2c787dd873fb0fac`

## Canonical boundary

- Compliance Timeline reads the authenticated case Timeline API; it does not project human history from browser storage.
- Decision Dashboard and CareDesk Score read the single authenticated case-health contract, including factor provenance and deterministic recommended actions. The score remains file health, not legal approval.
- Monthly Close is manager-authorized and stored in `payroll_month_close`. One transaction creates its immutable close, human Timeline event, minimal Audit event and durable idempotency receipt. Replay returns the original response.
- Future Cost uses canonical close receipts for closed-month status and immutable actual snapshots. Historical receipts without an amount snapshot are explicitly `UNKNOWN`; scenario assumptions remain transient and planning-only.

The older payroll-entry calculator still holds draft/open payroll inputs and scenario expenses in MVP storage because there is no canonical payroll-entry aggregate yet. It no longer writes or reads monthly-close receipts there. This is a quarantined remaining dependency, not a dual-write.

## Security and evidence

Tenant authority comes exclusively from the authenticated actor. Case authorization precedes reads and mutations, PostgreSQL RLS is forced on the existing close/Timeline/Audit/idempotency tables, and same-tenant close/case and Timeline references remain database constraints. The close command additionally verifies an active owner/manager membership. Cross-tenant case identifiers are returned as not found without mutation.

## Strict capability classification

1. Compliance Timeline — **COMPLETE** for the visible canonical case path.
2. Decision Dashboard — **COMPLETE** for case attention and health; profile summary cards remain transitional presentation only.
3. CareDesk Score — **COMPLETE** through the canonical application/API contract.
6. Monthly Close — **COMPLETE** for manager close, receipt, replay and evidence; worker acknowledgement remains a separate Wave 5 concern.
12. Future Cost — **PARTIAL** because open payroll/scenario inputs remain transitional, while closed actual history is canonical.

These classifications do not claim completion of all fifteen product capabilities. Hosted PostgreSQL RLS, Playwright, CodeQL and deployment checks remain the final merge-readiness evidence.
