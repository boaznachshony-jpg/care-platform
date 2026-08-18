# Risk Register

## High
1. Candidate branch is NOT merge-ready; no hosted validation.
2. Historical PR #52 had 11 files; reconstructed branch now has only 2. Missing dependencies must be rediscovered from current main, not blindly restored.
3. PR/Issue drift: PR #52 closed; Issue #63 still references it; Issue #54 is stale after PR #65.
4. `mvp-storage` remains active compatibility storage. Do not globally remove without a complete migration map.

## Medium
5. AI/OCR/WhatsApp must remain fail-closed until provider/privacy approval.
6. Keep Dependabot major upgrades separate.
7. Governance docs can lag code; prefer merged code + current CI.

## Security non-negotiables
- no real PII in fixtures/logs
- no secrets in browser/Git
- server-derived tenant
- FORCE RLS
- same-tenant FKs
- no raw storage keys
- short-lived signed URLs
- durable idempotency
- do not suppress CodeQL
