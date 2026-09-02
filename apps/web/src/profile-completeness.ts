/**
 * The single list of "is this profile complete" checks.
 *
 * This used to exist twice, verbatim, in DashboardPage and OpenIssuesPage.
 * Two copies of the same 14-field list meant adding a field to one screen
 * and forgetting the other silently made the two screens disagree about how
 * complete the same profile is - exactly the kind of quiet drift the rest of
 * this app works hard to avoid. There is now exactly one place a field can
 * be added, removed, or have its "missing" rule changed.
 */
import type { MvpProfile } from './storage/mvp-storage.js';

export type ProfileCompletenessFieldKey =
  | 'employerName'
  | 'recipientName'
  | 'caregiverName'
  | 'employmentStartDate'
  | 'representativeName'
  | 'licensedBureauName'
  | 'licensedBureauContactName'
  | 'licensedBureauContactPhone'
  | 'employmentAgreementConfirmed'
  | 'medicalInsurance'
  | 'baseSalary'
  | 'saturdayRate'
  | 'licenseRenewalDate'
  | 'visaRenewalDate';

/** Every field checked for profile completeness, and whether it is missing. */
export function profileCompletenessChecks(
  profile: MvpProfile,
): Array<[key: ProfileCompletenessFieldKey, missing: boolean]> {
  return [
    ['employerName', !profile.employerName.trim()],
    ['recipientName', !profile.recipientName.trim()],
    ['caregiverName', !profile.caregiverName.trim()],
    ['employmentStartDate', !profile.employmentStartDate.trim()],
    ['representativeName', !profile.representativeName.trim()],
    ['licensedBureauName', !profile.licensedBureauName.trim()],
    ['licensedBureauContactName', !profile.licensedBureauContactName.trim()],
    ['licensedBureauContactPhone', !profile.licensedBureauContactPhone.trim()],
    ['employmentAgreementConfirmed', !profile.employmentAgreementConfirmed],
    ['medicalInsurance', !profile.medicalInsuranceConfirmed || !profile.medicalInsuranceExpiryDate],
    ['baseSalary', (profile.baseSalary ?? 0) <= 0],
    ['saturdayRate', (profile.saturdayRate ?? 0) <= 0],
    ['licenseRenewalDate', !profile.licenseRenewalDate],
    ['visaRenewalDate', !profile.visaRenewalDate],
  ];
}

/** Keys of the fields currently missing, in check order - used for readable per-field labels. */
export function missingProfileFieldKeys(profile: MvpProfile): ProfileCompletenessFieldKey[] {
  return profileCompletenessChecks(profile)
    .filter(([, missing]) => missing)
    .map(([key]) => key);
}

/** How many of the tracked fields are missing - used where only the count is shown. */
export function missingProfileFieldCount(profile: MvpProfile): number {
  return missingProfileFieldKeys(profile).length;
}
