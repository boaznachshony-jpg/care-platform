# Legacy workspace data inventory and canonical mapping

Status: **Sprint 0 baseline**
Last updated: 2026-08-12

## Mapping unit

One legacy MVP client/workspace employment record maps to one tenant-scoped
`EmploymentCase` and its party graph:

```text
MvpClient.id (legacy correlation only)
  -> EmploymentCase.id (canonical)
     -> CareRecipient
     -> Employer
     -> Caregiver
```

The migration must keep an explicit, non-sensitive correlation record; labels
and names are not identity keys. `MvpClient` list fields are display/index
snapshots and must be regenerated from the case graph, not migrated as an
independent aggregate.

Priority meanings: **P0** identity/security and aggregate integrity, **P1**
required case operations, **P2** supporting preferences or future normalized
aggregates, **Hold** requires a protected-field/retention decision before
migration, **Retire** is transitional UI state rather than domain data.

## Inventory

| Legacy fields/data | Canonical target or disposition | State | Sensitivity | Priority |
|---|---|---|---|---|
| Cases and party graphs created through the normalized case repository | `employment_case` with linked `care_recipient`, `employer`, and `caregiver` | Normalized | employment/care by field | P0 |
| Documents created through the normalized document repository | `document` and immutable `document_version` | Normalized | by document class | P0 |
| `MvpClient.id`, tenant/client association | Migration correlation to `EmploymentCase.id`; never a case identity after cutover | Snapshot only | general | P0 |
| `employerName`, `employerRelationship`, `employerCity` | `employer.full_name`, `.relationship_to_recipient`, `.city` linked by EmploymentCase | Duplicated | employment_sensitive | P0 |
| `recipientName`, `recipientCareLevel`, `recipientCity` | `care_recipient.full_name`, `.care_level`, `.city` linked by EmploymentCase | Duplicated | care_sensitive | P0 |
| `caregiverName`, `caregiverCountry`, `caregiverLanguage` | `caregiver.legal_name`, `.nationality`, `.primary_language` linked by EmploymentCase | Duplicated | employment_sensitive | P0 |
| `employmentStartDate` | `employment_case.start_date`; status is assigned by an approved transformation, not inferred silently | Duplicated | employment_sensitive | P0 |
| Employer/recipient phone, email, and full address/postal code | Future party contact/address model; do not overload `contact` without an approved ownership mapping | Snapshot only | employment_sensitive | P1 |
| `recipientBirthDate`, `recipientHealthFund` | Future protected CareRecipient attributes | Snapshot only | care_sensitive | P1 |
| Representative fields | `contact`, `contact_channel`, `case_contact_role` after role semantics are approved | Snapshot only | employment_sensitive | P1 |
| Licensed bureau and bureau contact fields | `organization(type=licensed_bureau)`, `contact`, `contact_channel`, `case_contact_role` | Snapshot only | employment_sensitive | P1 |
| `medicalInsuranceExpiryDate` | `medical_insurance_policy.valid_to` when that aggregate is implemented; supporting file uses canonical documents | Snapshot only | financial_sensitive | P1 |
| `baseSalary`, `salaryEffectiveDate`, `saturdayRate` | Versioned `employment_contract` and/or payroll rule input; never mutable profile authority | Snapshot only | financial_sensitive | P1 |
| `visaRenewalDate` | `immigration_authorization.valid_to` when protected typed record exists | Snapshot only | identity_sensitive | P1 |
| `licenseRenewalDate` | Typed authorization/organization record only after its subject and semantics are confirmed | Snapshot only | identity_sensitive | P2 |
| Notification, reminder, and quiet-hour settings | Future tenant/user notification preferences, not EmploymentCase fields | Snapshot only | general | P2 |
| `onboardingCompleted` | Derived readiness/progress projection; do not migrate as canonical fact | Snapshot only | general | Retire |
| `employmentAgreementConfirmed` | Derive from active contract and verified supporting DocumentVersion | Snapshot only | employment_sensitive | Retire |
| `medicalInsuranceConfirmed` | Derive from policy and verified supporting DocumentVersion | Snapshot only | financial_sensitive | Retire |
| MVP client label/name copies and timestamps | Derived case selector projection; canonical timestamps come from aggregates | Duplicated | employment_sensitive | Retire |
| Legacy tasks and timeline items | `task` and append-only `timeline_event`, preserving source correlation and case link | Duplicated where already persisted; otherwise snapshot only | by item class | P1 |
| Legacy workspace file metadata | `document` plus immutable `document_version`; storage key remains opaque and private | Duplicated | by document class | P0 |
| `employerIdNumber`, `recipientIdNumber`, `recipientNationalInsuranceCaseNumber`, `caregiverPassportNumber`, `licensedBureauRegistrationNumber` | Approved encrypted/protected record or tokenized reference; **no plaintext normalized column** | Sensitive snapshot only | identity_sensitive | Hold |

## Classification rules

- **Normalized** means the normalized row is the write authority for that
  field; current examples include the established case graph and normalized
  records created through their repository paths.
- **Snapshot only** means no approved normalized destination exists yet. It is
  retained for compatibility and may not motivate a new `MvpProfile` field.
- **Duplicated** means the same semantic value can exist in legacy and
  normalized storage. The normalized value is canonical; the snapshot is
  compared or projected according to the migration phase.
- **Sensitive** values never appear in reconciliation payloads or new plaintext
  columns. Hash/presence comparison needs security approval because low-entropy
  identifiers may still be guessable.

This is a governance inventory, not authorization to copy data. A migration PR
must refine every affected row to an exact transformation and demonstrate the
controls in `strangler-migration.md`.
