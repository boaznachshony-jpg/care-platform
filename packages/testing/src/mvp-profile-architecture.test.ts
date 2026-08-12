import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// MvpProfile is a legacy, browser-local compatibility model. New business data
// belongs in the domain/application/database layers, not in this catch-all.
// Any intentional compatibility change must update this reviewable allowlist.
const APPROVED_MVP_PROFILE_FIELDS = [
  'employerName',
  'employerIdNumber',
  'employerPhone',
  'employerEmail',
  'employerRelationship',
  'employerAddress',
  'employerCity',
  'employerPostalCode',
  'recipientName',
  'recipientIdNumber',
  'recipientBirthDate',
  'recipientPhone',
  'recipientEmail',
  'recipientAddress',
  'recipientCity',
  'recipientPostalCode',
  'recipientHealthFund',
  'recipientCareLevel',
  'recipientNationalInsuranceCaseNumber',
  'caregiverName',
  'caregiverPassportNumber',
  'caregiverCountry',
  'caregiverLanguage',
  'employmentStartDate',
  'representativeName',
  'representativePhone',
  'representativeEmail',
  'representativeRelationship',
  'licensedBureauName',
  'licensedBureauRegistrationNumber',
  'licensedBureauContactName',
  'licensedBureauContactPhone',
  'licensedBureauContactEmail',
  'licensedBureauMainPhone',
  'licensedBureauAddress',
  'notificationsEnabled',
  'reminderLeadDays',
  'quietHoursStart',
  'quietHoursEnd',
  'onboardingCompleted',
  'employmentAgreementConfirmed',
  'medicalInsuranceConfirmed',
  'medicalInsuranceExpiryDate',
  'baseSalary',
  'salaryEffectiveDate',
  'saturdayRate',
  'licenseRenewalDate',
  'visaRenewalDate',
] as const;

describe('legacy MvpProfile architecture boundary', () => {
  it('does not acquire fields without an explicit guardrail review', async () => {
    const path = fileURLToPath(
      new URL('../../../apps/web/src/storage/mvp-storage.ts', import.meta.url),
    );
    const sourceText = await readFile(path, 'utf8');
    const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(
      (statement): statement is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(statement) && statement.name.text === 'MvpProfile',
    );

    expect(declaration, 'MvpProfile interface must remain discoverable by the guard').toBeDefined();
    const fields = declaration?.members.map((member) => member.name?.getText(source)) ?? [];

    expect(fields).toEqual(APPROVED_MVP_PROFILE_FIELDS);
  });
});
