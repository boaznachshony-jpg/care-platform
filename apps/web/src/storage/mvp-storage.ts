/* eslint-disable no-restricted-syntax */
import {
  decryptBusinessStorageValue,
  encryptBusinessStorageValue,
} from './business-storage-crypto.js';

export type ReminderLeadDays = 1 | 7 | 14 | 21 | 30;

export interface MvpProfile {
  employerName: string;
  employerIdNumber: string;
  employerPhone: string;
  recipientName: string;
  caregiverName: string;
  caregiverCountry: string;
  caregiverLanguage: string;
  employmentStartDate: string;
  representativeName: string;
  representativePhone: string;
  licensedBureauName: string;
  licensedBureauRegistrationNumber: string;
  licensedBureauContactName: string;
  licensedBureauContactPhone: string;
  licensedBureauContactEmail: string;
  licensedBureauMainPhone: string;
  licensedBureauAddress: string;
  notificationsEnabled: boolean;
  reminderLeadDays: ReminderLeadDays;
  quietHoursStart: string;
  quietHoursEnd: string;
  onboardingCompleted: boolean;
  employmentAgreementConfirmed: boolean;
  medicalInsuranceConfirmed: boolean;
  medicalInsuranceExpiryDate: string;
  baseSalary: number | null;
  salaryEffectiveDate: string;
  saturdayRate: number | null;
  licenseRenewalDate: string;
  visaRenewalDate: string;
}

const STORAGE_KEY = 'caredesk.mvp.profile.v1';
const CLIENTS_KEY = 'caredesk.mvp.clients.v1';
const MIGRATION_REDIRECT_KEY = 'caredesk.mvp.migration-redirect.v1';
const CLIENT_KEY_SEPARATOR = '.client.';
export const MVP_PROFILE_CHANGED = 'caredesk:mvp-profile-changed';
const MVP_STORAGE_PREFIX = 'caredesk.mvp.';
const NEW_EMPLOYER_LABEL = 'מעסיק חדש';
const LEGACY_NEW_CLIENT_LABEL = 'לקוח חדש';

export interface MvpClient {
  id: string;
  label: string;
  employerName: string;
  recipientName: string;
  caregiverName: string;
  createdAt: string;
  updatedAt: string;
}

export const emptyMvpProfile: MvpProfile = {
  employerName: '',
  employerIdNumber: '',
  employerPhone: '',
  recipientName: '',
  caregiverName: '',
  caregiverCountry: '',
  caregiverLanguage: '',
  employmentStartDate: '',
  representativeName: '',
  representativePhone: '',
  licensedBureauName: '',
  licensedBureauRegistrationNumber: '',
  licensedBureauContactName: '',
  licensedBureauContactPhone: '',
  licensedBureauContactEmail: '',
  licensedBureauMainPhone: '',
  licensedBureauAddress: '',
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: false,
  employmentAgreementConfirmed: false,
  medicalInsuranceConfirmed: false,
  medicalInsuranceExpiryDate: '',
  baseSalary: null,
  salaryEffectiveDate: '',
  saturdayRate: null,
  licenseRenewalDate: '',
  visaRenewalDate: '',
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readBusinessItem(key: string): string | null {
  const stored = window.localStorage.getItem(key);
  return stored === null ? null : decryptBusinessStorageValue(stored);
}

function writeBusinessItem(key: string, value: string): void {
  window.localStorage.setItem(key, encryptBusinessStorageValue(value));
}

export function clientIdFromPath(
  pathname = isBrowser() ? window.location.pathname : '',
): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function scopedKey(key: string, clientId = clientIdFromPath()): string {
  return clientId ? `${key}${CLIENT_KEY_SEPARATOR}${clientId}` : key;
}

function readClientsRaw(): MvpClient[] {
  if (!isBrowser()) return [];
  try {
    const clients = JSON.parse(readBusinessItem(CLIENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(clients) ? (clients as MvpClient[]) : [];
  } catch {
    return [];
  }
}

function saveClients(clients: MvpClient[]): void {
  writeBusinessItem(CLIENTS_KEY, JSON.stringify(clients));
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

function profileLabel(profile: Partial<MvpProfile>): string {
  return (
    profile.recipientName || profile.employerName || profile.caregiverName || NEW_EMPLOYER_LABEL
  );
}

export function isNewEmployerLabel(label: string): boolean {
  return label === NEW_EMPLOYER_LABEL || label === LEGACY_NEW_CLIENT_LABEL;
}

export function ensureMvpClientMigration(): MvpClient[] {
  const existing = readClientsRaw();
  if (existing.length > 0 || !isBrowser()) return existing;
  const legacyProfile = readMvpProfileForClient(null);
  const hasLegacyData =
    legacyProfile.onboardingCompleted ||
    [
      DOCUMENTS_KEY,
      PAYROLL_STORAGE_NAME,
      EMPLOYMENT_EXPENSES_STORAGE_NAME,
      TASKS_STORAGE_NAME,
    ].some((key) => readBusinessItem(key) !== null);
  if (!hasLegacyData) return [];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const client: MvpClient = {
    id,
    label: profileLabel(legacyProfile),
    employerName: legacyProfile.employerName,
    recipientName: legacyProfile.recipientName,
    caregiverName: legacyProfile.caregiverName,
    createdAt: now,
    updatedAt: now,
  };
  [
    STORAGE_KEY,
    DOCUMENTS_KEY,
    PAYROLL_STORAGE_NAME,
    EMPLOYMENT_EXPENSES_STORAGE_NAME,
    TASKS_STORAGE_NAME,
  ].forEach((key) => {
    const value = readBusinessItem(key);
    if (value !== null) writeBusinessItem(scopedKey(key, id), value);
  });
  saveClients([client]);
  writeBusinessItem(MIGRATION_REDIRECT_KEY, id);
  return [client];
}

export function consumeMvpMigrationRedirect(): string | null {
  if (!isBrowser()) return null;
  const clientId = readBusinessItem(MIGRATION_REDIRECT_KEY);
  if (clientId) window.localStorage.removeItem(MIGRATION_REDIRECT_KEY);
  return clientId;
}

export function readMvpClients(): MvpClient[] {
  return ensureMvpClientMigration().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createMvpClient(): MvpClient {
  const now = new Date().toISOString();
  const client: MvpClient = {
    id: crypto.randomUUID(),
    label: NEW_EMPLOYER_LABEL,
    employerName: '',
    recipientName: '',
    caregiverName: '',
    createdAt: now,
    updatedAt: now,
  };
  saveClients([client, ...readClientsRaw()]);
  writeBusinessItem(scopedKey(STORAGE_KEY, client.id), JSON.stringify(emptyMvpProfile));
  return client;
}

export function deleteMvpClient(clientId: string): void {
  const suffix = `${CLIENT_KEY_SEPARATOR}${clientId}`;
  Object.keys(window.localStorage)
    .filter((key) => key.endsWith(suffix))
    .forEach((key) => window.localStorage.removeItem(key));
  saveClients(readClientsRaw().filter((client) => client.id !== clientId));
}

export function resetMvpClient(clientId: string): void {
  const client = readClientsRaw().find((item) => item.id === clientId);
  const suffix = `${CLIENT_KEY_SEPARATOR}${clientId}`;
  Object.keys(window.localStorage)
    .filter((key) => key.endsWith(suffix))
    .forEach((key) => window.localStorage.removeItem(key));
  writeBusinessItem(scopedKey(STORAGE_KEY, clientId), JSON.stringify(emptyMvpProfile));
  if (client) {
    saveClients(
      readClientsRaw().map((item) =>
        item.id === clientId
          ? {
              ...item,
              label: NEW_EMPLOYER_LABEL,
              employerName: '',
              recipientName: '',
              caregiverName: '',
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }
}

export function exportMvpClient(clientId: string): string {
  const client = readClientsRaw().find((item) => item.id === clientId);
  const suffix = `${CLIENT_KEY_SEPARATOR}${clientId}`;
  const data = Object.fromEntries(
    Object.keys(window.localStorage)
      .filter((key) => key.endsWith(suffix))
      .map((key) => [key.slice(0, -suffix.length), readBusinessItem(key)]),
  );
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), client, data },
    null,
    2,
  );
}

function readMvpProfileForClient(clientId: string | null): MvpProfile {
  if (!isBrowser()) return emptyMvpProfile;
  try {
    const saved = JSON.parse(
      readBusinessItem(scopedKey(STORAGE_KEY, clientId)) ?? '{}',
    ) as Partial<MvpProfile> & { employmentFeeDueDate?: string };
    const { employmentFeeDueDate, ...currentSaved } = saved;
    const visaRenewalDate =
      typeof currentSaved.visaRenewalDate === 'string'
        ? currentSaved.visaRenewalDate
        : (employmentFeeDueDate ?? '');
    return {
      ...emptyMvpProfile,
      ...currentSaved,
      employerIdNumber:
        typeof currentSaved.employerIdNumber === 'string'
          ? currentSaved.employerIdNumber.replace(/\D/g, '').slice(0, 9)
          : '',
      visaRenewalDate,
    };
  } catch {
    return emptyMvpProfile;
  }
}

export function readMvpProfile(): MvpProfile {
  return readMvpProfileForClient(clientIdFromPath());
}

export function saveMvpProfile(profile: MvpProfile): void {
  if (!isBrowser()) return;
  const clientId = clientIdFromPath();
  const normalizedProfile = {
    ...profile,
    employerIdNumber: profile.employerIdNumber.replace(/\D/g, '').slice(0, 9),
  };
  writeBusinessItem(scopedKey(STORAGE_KEY, clientId), JSON.stringify(normalizedProfile));
  if (clientId) {
    const now = new Date().toISOString();
    saveClients(
      readClientsRaw().map((client) =>
        client.id === clientId
          ? {
              ...client,
              label: profileLabel(normalizedProfile),
              employerName: normalizedProfile.employerName,
              recipientName: normalizedProfile.recipientName,
              caregiverName: normalizedProfile.caregiverName,
              updatedAt: now,
            }
          : client,
      ),
    );
  }
  syncAutomaticTasks(normalizedProfile);
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
  dataUrl?: string;
  updatedAt: string;
}

export interface MvpAdditionalPayment {
  id: string;
  description: string;
  amount: number;
}

export interface MvpPayrollRecord {
  id: string;
  month: string;
  baseSalary: number;
  contractBaseSalary?: number;
  prorationStartDate?: string;
  prorationDays?: number;
  workDays: number;
  vacationDays?: number;
  sickDays?: number;
  absenceDays?: number;
  paidSaturdays: number;
  saturdayRate?: number;
  paidHolidays?: number;
  saturdayPay: number;
  holidayPay?: number;
  vacationPay?: number;
  sickPay?: number;
  pocketMoney: number;
  employerContributions?: number;
  otherAddition: number;
  additionalPayments?: MvpAdditionalPayment[];
  medicalInsuranceDeduction?: number;
  housingDeduction?: number;
  advances: number;
  agreedDeduction: number;
  total: number;
  savedAt: string;
}

export type EmploymentExpenseFrequency = 'monthly' | 'quarterly' | 'annual' | 'one_time';
export type EmploymentExpenseStatus = 'upcoming' | 'paid';

export interface MvpEmploymentExpense {
  id: string;
  category: string;
  frequency: EmploymentExpenseFrequency;
  amount: number;
  amountEntered?: boolean;
  dueDate: string;
  status: EmploymentExpenseStatus;
  note: string;
  savedAt: string;
  source?: 'payroll-national-insurance';
  sourcePeriod?: string;
}

export type MvpTaskPriority = 'normal' | 'important' | 'urgent';
export type MvpTaskStatus = 'open' | 'completed';
export type MvpTaskSource = 'medical-insurance' | 'employment-license' | 'visa-renewal';

export interface MvpTask {
  id: string;
  title: string;
  dueDate: string;
  priority: MvpTaskPriority;
  status: MvpTaskStatus;
  createdAt: string;
  source?: MvpTaskSource;
  sourceDate?: string;
}

const DOCUMENTS_KEY = 'caredesk.mvp.documents.v1';
const PAYROLL_STORAGE_NAME = 'caredesk.mvp.payroll.v1';
const EMPLOYMENT_EXPENSES_STORAGE_NAME = 'caredesk.mvp.employment-expenses.v1';
const TASKS_STORAGE_NAME = 'caredesk.mvp.tasks.v1';

function readList<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const value = JSON.parse(readBusinessItem(scopedKey(key)) ?? '[]') as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, value: T[]): void {
  if (!isBrowser()) return;
  writeBusinessItem(scopedKey(key), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

interface AutomaticTaskConfig {
  id: string;
  title: string;
  dueDate: string;
  enabled: boolean;
  source: MvpTaskSource;
}

function validTaskDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function automaticTaskConfigs(profile: MvpProfile): AutomaticTaskConfig[] {
  return [
    {
      id: 'system-medical-insurance-renewal',
      title: 'חידוש ביטוח רפואי',
      dueDate: profile.medicalInsuranceExpiryDate,
      enabled:
        profile.medicalInsuranceConfirmed && validTaskDate(profile.medicalInsuranceExpiryDate),
      source: 'medical-insurance',
    },
    {
      id: 'system-employment-license-renewal',
      title: 'חידוש רישיון ההעסקה',
      dueDate: profile.licenseRenewalDate,
      enabled: validTaskDate(profile.licenseRenewalDate),
      source: 'employment-license',
    },
    {
      id: 'system-visa-renewal',
      title: 'חידוש הוויזה',
      dueDate: profile.visaRenewalDate,
      enabled: validTaskDate(profile.visaRenewalDate),
      source: 'visa-renewal',
    },
  ];
}

function syncAutomaticTasks(profile: MvpProfile): void {
  const tasks = readList<MvpTask>(TASKS_STORAGE_NAME);
  let next = tasks;

  for (const config of automaticTaskConfigs(profile)) {
    const existing = next.find((task) => task.source === config.source);
    if (!config.enabled) {
      if (existing) next = next.filter((task) => task.id !== existing.id);
      continue;
    }

    const task: MvpTask = {
      id: existing?.id ?? config.id,
      title: config.title,
      dueDate: config.dueDate,
      priority: 'important',
      status: existing?.sourceDate === config.dueDate ? existing.status : 'open',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      source: config.source,
      sourceDate: config.dueDate,
    };
    next = existing ? next.map((item) => (item.id === existing.id ? task : item)) : [task, ...next];
  }

  if (JSON.stringify(next) !== JSON.stringify(tasks)) {
    saveList(TASKS_STORAGE_NAME, next);
  }
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

export function readMvpEmploymentExpenses(): MvpEmploymentExpense[] {
  return readList<MvpEmploymentExpense>(EMPLOYMENT_EXPENSES_STORAGE_NAME);
}

export function saveMvpEmploymentExpenses(expenses: MvpEmploymentExpense[]): void {
  saveList(EMPLOYMENT_EXPENSES_STORAGE_NAME, expenses);
}

export function readMvpTasks(): MvpTask[] {
  syncAutomaticTasks(readMvpProfile());
  return readList<MvpTask>(TASKS_STORAGE_NAME);
}

export function saveMvpTasks(tasks: MvpTask[]): void {
  saveList(TASKS_STORAGE_NAME, tasks);
}

export interface MvpWorkspaceSnapshot {
  schemaVersion: 1;
  entries: Record<string, string>;
}

/** Captures only CareDesk business data; UI preferences remain device-local. */
export function captureMvpWorkspace(): MvpWorkspaceSnapshot {
  if (!isBrowser()) return { schemaVersion: 1, entries: {} };
  const entries = Object.fromEntries(
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(MVP_STORAGE_PREFIX))
      .map((key) => [key, readBusinessItem(key) ?? '']),
  );
  return { schemaVersion: 1, entries };
}

/** Replaces all local business data so accounts never share a browser cache. */
export function replaceMvpWorkspace(snapshot: MvpWorkspaceSnapshot): void {
  if (!isBrowser()) return;
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith(MVP_STORAGE_PREFIX))
    .forEach((key) => window.localStorage.removeItem(key));
  Object.entries(snapshot.entries).forEach(([key, value]) => {
    if (key.startsWith(MVP_STORAGE_PREFIX)) writeBusinessItem(key, value);
  });
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

export function clearMvpWorkspace(): void {
  replaceMvpWorkspace({ schemaVersion: 1, entries: {} });
}
