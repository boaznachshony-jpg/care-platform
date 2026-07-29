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
  baseSalary: number | null;
  salaryEffectiveDate: string;
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
  baseSalary: null,
  salaryEffectiveDate: '',
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

export type MvpDocumentStatus = 'valid' | 'attention';

export interface MvpDocument {
  id: string;
  name: string;
  category: string;
  dateLabel: string;
  status: MvpDocumentStatus;
  fileName: string;
  fileType: string;
  dataUrl: string;
  updatedAt: string;
}

export interface MvpPayrollRecord {
  id: string;
  month: string;
  baseSalary: number;
  workDays: number;
  paidSaturdays: number;
  saturdayPay: number;
  pocketMoney: number;
  otherAddition: number;
  advances: number;
  agreedDeduction: number;
  total: number;
  savedAt: string;
}

const DOCUMENTS_KEY = 'caredesk.mvp.documents.v1';
const PAYROLL_STORAGE_NAME = 'caredesk.mvp.payroll.v1';

function readList<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, value: T[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

export function readMvpDocuments(): MvpDocument[] {
  return readList<MvpDocument>(DOCUMENTS_KEY);
}

export function saveMvpDocuments(documents: MvpDocument[]): void {
  saveList(DOCUMENTS_KEY, documents);
}

export function readMvpPayroll(): MvpPayrollRecord[] {
  return readList<MvpPayrollRecord>(PAYROLL_STORAGE_NAME);
}

export function saveMvpPayroll(records: MvpPayrollRecord[]): void {
  saveList(PAYROLL_STORAGE_NAME, records);
}
