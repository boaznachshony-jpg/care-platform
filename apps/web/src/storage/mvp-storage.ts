export type ReminderLeadDays = 1 | 7 | 14 | 21 | 30;

export interface MvpProfile {
  employerName: string;
  employerPhone: string;
  recipientName: string;
  caregiverName: string;
  employmentStartDate: string;
  representativeName: string;
  representativePhone: string;
  notificationsEnabled: boolean;
  reminderLeadDays: ReminderLeadDays;
  quietHoursStart: string;
  quietHoursEnd: string;
  onboardingCompleted: boolean;
}

const STORAGE_KEY = 'caredesk.mvp.profile.v1';
export const MVP_PROFILE_CHANGED = 'caredesk:mvp-profile-changed';

export const emptyMvpProfile: MvpProfile = {
  employerName: '',
  employerPhone: '',
  recipientName: '',
  caregiverName: '',
  employmentStartDate: '',
  representativeName: '',
  representativePhone: '',
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: false,
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readMvpProfile(): MvpProfile {
  if (!isBrowser()) return emptyMvpProfile;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<MvpProfile>;
    return { ...emptyMvpProfile, ...saved };
  } catch {
    return emptyMvpProfile;
  }
}

export function saveMvpProfile(profile: MvpProfile): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

export function updateMvpProfile(changes: Partial<MvpProfile>): MvpProfile {
  const updated = { ...readMvpProfile(), ...changes };
  saveMvpProfile(updated);
  return updated;
}
