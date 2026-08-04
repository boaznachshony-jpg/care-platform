/* eslint-disable no-restricted-syntax */
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
  notificationsEnabled: boolean;
  reminderLeadDays: ReminderLeadDays;
  quietHoursStart: string;
  quietHoursEnd: string;
  onboardingCompleted: boolean;
  baseSalary: number | null;
  salaryEffectiveDate: string;
}

const STORAGE_KEY = 'caredesk.mvp.profile.v1';
const CLIENTS_KEY = 'caredesk.mvp.clients.v1';
const MIGRATION_REDIRECT_KEY = 'caredesk.mvp.migration-redirect.v1';
const CLIENT_KEY_SEPARATOR = '.client.';
export const MVP_PROFILE_CHANGED = 'caredesk:mvp-profile-changed';
const MVP_STORAGE_PREFIX = 'caredesk.mvp.';

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
    const clients = JSON.parse(window.localStorage.getItem(CLIENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(clients) ? (clients as MvpClient[]) : [];
  } catch {
    return [];
  }
}

function saveClients(clients: MvpClient[]): void {
  window.localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

function profileLabel(profile: Partial<MvpProfile>): string {
  return profile.recipientName || profile.employerName || profile.caregiverName || 'לקוח חדש';
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
    ].some((key) => window.localStorage.getItem(key) !== null);
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
    const value = window.localStorage.getItem(key);
    if (value !== null) window.localStorage.setItem(scopedKey(key, id), value);
  });
  saveClients([client]);
  window.localStorage.setItem(MIGRATION_REDIRECT_KEY, id);
  return [client];
}

export function consumeMvpMigrationRedirect(): string | null {
  if (!isBrowser()) return null;
  const clientId = window.localStorage.getItem(MIGRATION_REDIRECT_KEY);
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
    label: 'לקוח חדש',
    employerName: '',
    recipientName: '',
    caregiverName: '',
    createdAt: now,
    updatedAt: now,
  };
  saveClients([client, ...readClientsRaw()]);
  window.localStorage.setItem(scopedKey(STORAGE_KEY, client.id), JSON.stringify(emptyMvpProfile));
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
  window.localStorage.setItem(scopedKey(STORAGE_KEY, clientId), JSON.stringify(emptyMvpProfile));
  if (client) {
    saveClients(
      readClientsRaw().map((item) =>
        item.id === clientId
          ? {
              ...item,
              label: 'לקוח חדש',
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
      .map((key) => [key.slice(0, -suffix.length), window.localStorage.getItem(key)]),
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
      window.localStorage.getItem(scopedKey(STORAGE_KEY, clientId)) ?? '{}',
    ) as Partial<MvpProfile>;
    return { ...emptyMvpProfile, ...saved };
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
  window.localStorage.setItem(scopedKey(STORAGE_KEY, clientId), JSON.stringify(profile));
  if (clientId) {
    const now = new Date().toISOString();
    saveClients(
      readClientsRaw().map((client) =>
        client.id === clientId
          ? {
              ...client,
              label: profileLabel(profile),
              employerName: profile.employerName,
              recipientName: profile.recipientName,
              caregiverName: profile.caregiverName,
              updatedAt: now,
            }
          : client,
      ),
    );
  }
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
  dueDate: string;
  status: EmploymentExpenseStatus;
  note: string;
  savedAt: string;
}

export type MvpTaskPriority = 'normal' | 'important' | 'urgent';
export type MvpTaskStatus = 'open' | 'completed';

export interface MvpTask {
  id: string;
  title: string;
  dueDate: string;
  priority: MvpTaskPriority;
  status: MvpTaskStatus;
  createdAt: string;
}

const DOCUMENTS_KEY = 'caredesk.mvp.documents.v1';
const PAYROLL_STORAGE_NAME = 'caredesk.mvp.payroll.v1';
const EMPLOYMENT_EXPENSES_STORAGE_NAME = 'caredesk.mvp.employment-expenses.v1';
const TASKS_STORAGE_NAME = 'caredesk.mvp.tasks.v1';

function readList<T>(key: string): T[] {
  if (!isBrowser()) return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(scopedKey(key)) ?? '[]') as unknown;
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function saveList<T>(key: string, value: T[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(scopedKey(key), JSON.stringify(value));
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

export function readMvpEmploymentExpenses(): MvpEmploymentExpense[] {
  return readList<MvpEmploymentExpense>(EMPLOYMENT_EXPENSES_STORAGE_NAME);
}

export function saveMvpEmploymentExpenses(expenses: MvpEmploymentExpense[]): void {
  saveList(EMPLOYMENT_EXPENSES_STORAGE_NAME, expenses);
}

export function readMvpTasks(): MvpTask[] {
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
      .map((key) => [key, window.localStorage.getItem(key) ?? '']),
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
    if (key.startsWith(MVP_STORAGE_PREFIX)) window.localStorage.setItem(key, value);
  });
  window.dispatchEvent(new CustomEvent(MVP_PROFILE_CHANGED));
}

export function clearMvpWorkspace(): void {
  replaceMvpWorkspace({ schemaVersion: 1, entries: {} });
}
