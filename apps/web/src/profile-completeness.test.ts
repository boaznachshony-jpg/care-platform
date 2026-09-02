import { describe, expect, it } from 'vitest';
import { emptyMvpProfile, type MvpProfile } from './storage/mvp-storage.js';
import {
  missingProfileFieldCount,
  missingProfileFieldKeys,
  profileCompletenessChecks,
} from './profile-completeness.js';

// Constitution §16: synthetic data only.
const completeProfile: MvpProfile = {
  ...emptyMvpProfile,
  employerName: 'בועז בדיקה',
  recipientName: 'מטופל בדיקה',
  caregiverName: 'אנה פטרוב',
  employmentStartDate: '2026-01-15',
  representativeName: 'נציג בדיקה',
  licensedBureauName: 'תאגיד בדיקה',
  licensedBureauContactName: 'איש קשר תאגיד',
  licensedBureauContactPhone: '0531234567',
  employmentAgreementConfirmed: true,
  medicalInsuranceConfirmed: true,
  medicalInsuranceExpiryDate: '2027-01-01',
  baseSalary: 7000,
  saturdayRate: 300,
  licenseRenewalDate: '2027-06-01',
  visaRenewalDate: '2027-06-01',
};

describe('profileCompletenessChecks', () => {
  it('lists all fourteen tracked fields', () => {
    expect(profileCompletenessChecks(completeProfile)).toHaveLength(14);
  });

  it('marks nothing missing for a fully filled-in profile', () => {
    expect(missingProfileFieldKeys(completeProfile)).toEqual([]);
    expect(missingProfileFieldCount(completeProfile)).toBe(0);
  });
});

describe('missingProfileFieldKeys', () => {
  it('flags a blank required text field', () => {
    const profile = { ...completeProfile, employerName: '  ' };
    expect(missingProfileFieldKeys(profile)).toContain('employerName');
  });

  it('flags medical insurance as missing when confirmed but the expiry date is blank', () => {
    const profile = { ...completeProfile, medicalInsuranceExpiryDate: '' };
    expect(missingProfileFieldKeys(profile)).toContain('medicalInsurance');
  });

  it('flags medical insurance as missing when the expiry date is set but not confirmed', () => {
    const profile = { ...completeProfile, medicalInsuranceConfirmed: false };
    expect(missingProfileFieldKeys(profile)).toContain('medicalInsurance');
  });

  it('flags a zero or null salary figure as missing', () => {
    expect(missingProfileFieldKeys({ ...completeProfile, baseSalary: 0 })).toContain('baseSalary');
    expect(missingProfileFieldKeys({ ...completeProfile, baseSalary: null })).toContain(
      'baseSalary',
    );
  });

  it('counts every missing field', () => {
    const profile = {
      ...completeProfile,
      employerName: '',
      recipientName: '',
      saturdayRate: 0,
    };
    expect(missingProfileFieldCount(profile)).toBe(3);
  });
});
