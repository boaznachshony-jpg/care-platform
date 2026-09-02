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
  employerEmail: string;
  employerRelationship: string;
  employerAddress: string;
  employerCity: string;
  employerPostalCode: string;
  recipientName: string;
  recipientIdNumber: string;
  recipientBirthDate: string;
  recipientPhone: string;
  recipientEmail: string;
  recipientAddress: string;
  recipientCity: string;
  recipientPostalCode: string;
  recipientHealthFund: string;
  recipientCareLevel: string;
  recipientNationalInsuranceCaseNumber: string;
  caregiverName: string;
  caregiverPassportNumber: string;
  caregiverCountry: string;
  caregiverLanguage: string;
  employmentStartDate: string;
  representativeName: string;
  representativePhone: string;
  representativeEmail: string;
  representativeRelationship: string;
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
  employerEmail: '',
  employerRelationship: '',
  employerAddress: '',
  employerCity: '',
  employerPostalCode: '',
  recipientName: '',
  recipientIdNumber: '',
  recipientBirthDate: '',
  recipientPhone: '',
  recipientEmail: '',
  recipientAddress: '',
  recipientCity: '',
  recipientPostalCode: '',
  recipientHealthFund: '',
  recipientCareLevel: '',
  recipientNationalInsuranceCaseNumber: '',
  caregiverName: '',
  caregiverPassportNumber: '',
  caregiverCountry: '',
  caregiverLanguage: '',
  employmentStartDate: '',
  representativeName: '',
  representativePhone: '',
  representativeEmail: '',
  representativeRelationship: '',
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
      recipientIdNumber:
        typeof currentSaved.recipientIdNumber === 'string'
          ? currentSaved.recipientIdNumber.replace(/\D/g, '').slice(0, 9)
          : '',
      caregiverPassportNumber:
        typeof currentSaved.caregiverPassportNumber === 'string'
          ? currentSaved.caregiverPassportNumber
              .replace(/[^a-zA-Z0-9]/g, '')
              .toUpperCase()
              .slice(0, 20)
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
    employerEmail: profile.employerEmail.trim().toLowerCase(),
    recipientIdNumber: profile.recipientIdNumber.replace(/\D/g, '').slice(0, 9),
    recipientEmail: profile.recipientEmail.trim().toLowerCase(),
    caregiverPassportNumber: profile.caregiverPassportNumber
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 20),
    representativeEmail: profile.representativeEmail.trim().toLowerCase(),
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

const ONBOARDING_DRAFT_KEY = 'caredesk.mvp.onboarding-draft.v1';

/** A yes/no wizard answer; '' means the question was never answered. */
export type MvpOnboardingChoice = '' | 'yes' | 'no';

export interface MvpOnboardingDraft {
  savedAt: string;
  profile: MvpProfile;
  /**
   * Wizard-only answers that have no committed-profile field of their own.
   * Without them a reload could not restore the same-person / helper radios
   * exactly as the user left them.
   */
  samePersonChoice: MvpOnboardingChoice;
  helperChoice: MvpOnboardingChoice;
}

function parseOnboardingChoice(value: unknown): MvpOnboardingChoice {
  return value === 'yes' || value === 'no' ? value : '';
}

/**
 * In-progress onboarding answers, saved while the user types so leaving a
 * step never loses input. Kept separate from the committed profile: a draft
 * may hold invalid values, so it must never feed reminders or reports.
 */
export function readMvpOnboardingDraft(): MvpOnboardingDraft | null {
  if (!isBrowser()) return null;
  try {
    const raw = readBusinessItem(scopedKey(ONBOARDING_DRAFT_KEY));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<MvpOnboardingDraft>;
    if (typeof parsed?.profile !== 'object' || parsed.profile === null) return null;
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      profile: { ...emptyMvpProfile, ...parsed.profile },
      samePersonChoice: parseOnboardingChoice(parsed.samePersonChoice),
      helperChoice: parseOnboardingChoice(parsed.helperChoice),
    };
  } catch {
    return null;
  }
}

export function saveMvpOnboardingDraft(
  profile: MvpProfile,
  choices?: { samePersonChoice?: MvpOnboardingChoice; helperChoice?: MvpOnboardingChoice },
): void {
  if (!isBrowser()) return;
  const draft: MvpOnboardingDraft = {
    savedAt: new Date().toISOString(),
    profile,
    samePersonChoice: choices?.samePersonChoice ?? '',
    helperChoice: choices?.helperChoice ?? '',
  };
  writeBusinessItem(scopedKey(ONBOARDING_DRAFT_KEY), JSON.stringify(draft));
}

export function clearMvpOnboardingDraft(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(scopedKey(ONBOARDING_DRAFT_KEY));
}

/**
 * The profile that should prefill a form on the current screen. Client-scoped
 * routes resolve to their own client; screens that live outside those routes
 * (billing, open-case) fall back to the most recently updated client so setup
 * data still flows forward instead of being typed a second time.
 */
export function readActiveMvpProfile(): MvpProfile {
  const direct = readMvpProfile();
  if (direct.onboardingCompleted || direct.recipientName || direct.employerName) return direct;
  const [latest] = readMvpClients();
  return latest ? readMvpProfileForClient(latest.id) : direct;
}

/**
 * Identity details that describe one human being, so when the employer and the
 * care recipient are the same person a value typed on either side also answers
 * the other.
 */
const SAME_PERSON_MIRRORED_FIELDS = [
  ['employerIdNumber', 'recipientIdNumber'],
  ['employerPhone', 'recipientPhone'],
  ['employerEmail', 'recipientEmail'],
  ['employerAddress', 'recipientAddress'],
  ['employerCity', 'recipientCity'],
  ['employerPostalCode', 'recipientPostalCode'],
] as const;

/** True when onboarding recorded the employer and the recipient as one person. */
export function isSameEmployerAndRecipient(profile: MvpProfile): boolean {
  return Boolean(profile.employerName) && profile.employerName === profile.recipientName;
}

/**
 * Mirrors the shared identity fields between the employer and the recipient
 * when they are the same person, so a detail given once during setup is never
 * asked for again. Only empty fields are filled — an explicitly entered value
 * is never overwritten — and different people are never cross-filled.
 */
export function withSamePersonFallbacks(profile: MvpProfile): MvpProfile {
  if (!isSameEmployerAndRecipient(profile)) return profile;
  const next = { ...profile };
  for (const [employerKey, recipientKey] of SAME_PERSON_MIRRORED_FIELDS) {
    if (!next[recipientKey] && next[employerKey]) next[recipientKey] = next[employerKey];
    else if (!next[employerKey] && next[recipientKey]) next[employerKey] = next[recipientKey];
  }
  return next;
}

/**
 * Recipient contact details for prefilling payer/billing forms. Billing lives
 * outside the client-scoped routes, so when the current path carries no
 * client the most recently updated client profile is used as a fallback.
 */
export function readMvpRecipientContact(): { name: string; email: string } {
  const direct = readMvpProfile();
  if (direct.recipientName || direct.recipientEmail) {
    return { name: direct.recipientName, email: direct.recipientEmail };
  }
  const [latest] = readMvpClients();
  if (!latest) return { name: '', email: '' };
  const profile = readMvpProfileForClient(latest.id);
  return { name: profile.recipientName, email: profile.recipientEmail };
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
  /** Server optimistic-lock version; absent only on pre-cutover migration records. */
  canonicalVersion?: number;
}

export interface MvpMonthlyClose {
  id: string;
  payrollRecordId: string;
  month: string;
  status: 'closed';
  paymentDate: string;
  paymentMethod: 'bank_transfer' | 'cash' | 'check' | 'other';
  evidenceDocumentId?: string;
  closedAt: string;
  /** Worker acknowledgement is intentionally not claimed before the worker portal exists. */
  workerAcknowledgement: 'not_supported';
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
const MEDICATIONS_STORAGE_NAME = 'caredesk.mvp.medications.v1';
const MONTHLY_CLOSE_STORAGE_NAME = 'caredesk.mvp.monthly-close.v1';

/**
 * `clientId` is optional and, when omitted, falls through to `scopedKey`'s own
 * default (`clientIdFromPath()`) — the ordinary case for every existing
 * caller. Passing it explicitly is only for the `*ForClient` read-only
 * helpers below, which run on screens that have no client id in their route.
 */
function readList<T>(key: string, clientId?: string | null): T[] {
  if (!isBrowser()) return [];
  try {
    const value = JSON.parse(
      readBusinessItem(clientId === undefined ? scopedKey(key) : scopedKey(key, clientId)) ?? '[]',
    ) as unknown;
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

/**
 * Read-only variants that take an explicit client id rather than inferring it
 * from `window.location`. Needed by the case-scoped screens (`/cases/:caseId`,
 * e.g. CaseTasksSection/CaseDocumentsSection) which have no `:clientId` route
 * segment for `clientIdFromPath()` to read — they only know the *canonical*
 * case id and must resolve `employment_case.legacy_client_id` themselves
 * (see canonical-case.ts) before they can find this device's matching local
 * records to offer for one-time upload. Never used to write: the existing
 * client-scoped read/write pair above remains the only path business data is
 * saved through.
 */
export function readMvpTasksForClient(clientId: string | null): MvpTask[] {
  return readList<MvpTask>(TASKS_STORAGE_NAME, clientId);
}

export function readMvpDocumentsForClient(clientId: string | null): MvpDocument[] {
  return readList<MvpDocument>(DOCUMENTS_KEY, clientId);
}

export function readMvpMedicationsForClient(clientId: string | null): MvpMedication[] {
  return readList<MvpMedication>(MEDICATIONS_STORAGE_NAME, clientId);
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

export function readMvpMonthlyCloses(): MvpMonthlyClose[] {
  return readList<MvpMonthlyClose>(MONTHLY_CLOSE_STORAGE_NAME);
}

/** Idempotent by payroll month. A close receipt is immutable in the MVP store. */
export function closeMvpPayrollMonth(
  input: Omit<MvpMonthlyClose, 'id' | 'status' | 'closedAt' | 'workerAcknowledgement'>,
): MvpMonthlyClose {
  const existing = readMvpMonthlyCloses().find((close) => close.month === input.month);
  if (existing) return existing;
  const close: MvpMonthlyClose = {
    ...input,
    id: crypto.randomUUID(),
    status: 'closed',
    closedAt: new Date().toISOString(),
    workerAcknowledgement: 'not_supported',
  };
  saveList(MONTHLY_CLOSE_STORAGE_NAME, [...readMvpMonthlyCloses(), close]);
  return close;
}

/**
 * A standing medication the care recipient takes.
 *
 * This is a transcription of what the family already knows, kept so that a
 * replacement caregiver or a family member stepping in has the information in
 * one place. It is explicitly NOT a prescription and NOT medical advice - the
 * same stance the product takes on payroll: the record belongs to the client,
 * and the system stores it faithfully without interpreting it.
 *
 * `timesOfDay` is deliberately a set of named slots rather than clock times.
 * Households say "morning and evening", not "08:00 and 20:00", and a slot
 * cannot be silently wrong the way a specific hour can.
 */
export const MEDICATION_TIMES = ['morning', 'noon', 'evening', 'night'] as const;
export type MvpMedicationTime = (typeof MEDICATION_TIMES)[number];

/**
 * The days a medication may be tied to, in Israeli week order.
 *
 * Names, not numbers. A number would have to pick between the two conventions
 * that both look reasonable in this codebase - JavaScript's `getDay()`, where
 * Sunday is 0, and ISO-8601, where Monday is 1 and Sunday is 7 - and a JSON
 * blob written under one convention and read under the other moves every
 * reminder by a day without anything failing. `'sunday'` cannot be misread.
 *
 * The array order is the order the week is spoken and printed in Israel:
 * Sunday first, Saturday last. Iterating it is what keeps the checkbox row and
 * any rendered list in that order regardless of the order boxes were ticked.
 */
export const MEDICATION_DAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type MvpMedicationDay = (typeof MEDICATION_DAYS)[number];

export interface MvpMedication {
  id: string;
  /** Medication name exactly as written on the box or the prescription. */
  name: string;
  /** Free text: "1 tablet", "5ml" - never parsed, never calculated on. */
  dosage: string;
  /** Empty means "as needed" rather than "unknown"; the UI states which. */
  timesOfDay: MvpMedicationTime[];
  /** True when it is taken every day, as opposed to specific days only. */
  daily: boolean;
  /**
   * The days it is taken when `daily` is false. Only meaningful in that case.
   *
   * Optional on purpose, and the three states are distinct on purpose:
   *
   * - absent (`undefined`) - a record saved before this field existed. Nothing
   *   was ever asked, so nothing is assumed: it behaves exactly as it did
   *   before, which for a non-daily medication means no reminder is sent.
   * - `[]` - the family reached the day picker and chose nothing yet. Same
   *   outcome, no reminder, but the screen says so out loud.
   * - a non-empty list - the days a reminder may fire on.
   *
   * Collapsing absent into `[]` would be harmless today; keeping them apart is
   * what lets a later migration tell "never asked" from "asked, not answered"
   * without guessing on someone's medication.
   */
  daysOfWeek?: MvpMedicationDay[];
  /** The doctor who prescribed it, so a stand-in knows who to call. */
  prescribingDoctor: string;
  /** Anything the family wants the next person to know. */
  notes: string;
  updatedAt: string;
}

export function readMvpMedications(): MvpMedication[] {
  return readList<MvpMedication>(MEDICATIONS_STORAGE_NAME);
}

export function saveMvpMedications(medications: MvpMedication[]): void {
  saveList(MEDICATIONS_STORAGE_NAME, medications);
}

/**
 * Who gets told, and how.
 *
 * The channel belongs to the recipient rather than to the account, and that is
 * not a preference setting - it is a correctness requirement. A daughter
 * travelling abroad on an eSIM data plan has internet but no cellular line, so
 * an SMS to her never arrives and nobody finds out it didn't. She needs
 * WhatsApp or email; her brother at home is fine with SMS. One global channel
 * would quietly fail exactly the person most likely to be relied upon.
 *
 * WhatsApp and email travel over data and are immune to that gap. SMS is the
 * bridge until WhatsApp Business is approved, which is why the field exists
 * from the start even while only some channels are wired up.
 */
export const REMINDER_CHANNELS = ['sms', 'whatsapp', 'email'] as const;
export type MvpReminderChannel = (typeof REMINDER_CHANNELS)[number];

export interface MvpReminderRecipient {
  id: string;
  name: string;
  /** "בת", "בן", "אחיין" - free text, shown so the reader knows who this is. */
  relationship: string;
  /** International format is expected; stored exactly as entered. */
  phone: string;
  email: string;
  channel: MvpReminderChannel;
  /**
   * When this person agreed to receive reminders. Empty means no consent yet.
   *
   * A medication reminder about someone else is health information about a
   * third party. Consent is recorded per recipient, is never assumed from the
   * account holder, and is the gate that `canReceiveReminders` enforces.
   */
  consentAt: string;
  /** Who recorded the consent, so the record can be audited later. */
  consentBy: string;
  /** Lets a recipient be paused without deleting the consent history. */
  active: boolean;
  updatedAt: string;
}

const REMINDER_RECIPIENTS_STORAGE_NAME = 'caredesk.mvp.reminder-recipients.v1';

/** The contact field a channel actually delivers to. */
export function reminderContactFor(recipient: MvpReminderRecipient): string {
  return recipient.channel === 'email' ? recipient.email.trim() : recipient.phone.trim();
}

/**
 * The single gate every send must pass. Deliberately conservative: a recipient
 * who is paused, who never consented, or whose chosen channel has no address
 * is not contacted, and the caller is expected to surface that rather than
 * silently skip them.
 */
export function canReceiveReminders(recipient: MvpReminderRecipient): boolean {
  return (
    recipient.active && recipient.consentAt.trim() !== '' && reminderContactFor(recipient) !== ''
  );
}

export function readMvpReminderRecipients(): MvpReminderRecipient[] {
  return readList<MvpReminderRecipient>(REMINDER_RECIPIENTS_STORAGE_NAME);
}

export function saveMvpReminderRecipients(recipients: MvpReminderRecipient[]): void {
  saveList(REMINDER_RECIPIENTS_STORAGE_NAME, recipients);
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

export interface MvpWorkspaceCapture extends MvpWorkspaceSnapshot {
  /**
   * Keys that exist in localStorage but could not be decrypted.
   *
   * The device cache is encrypted with a key held in sessionStorage while the
   * data itself lives in localStorage, so the data outlives the key: a
   * returning visitor has 27 stored keys and no way to read any of them. This
   * count is the difference between "the customer has no data" and "we cannot
   * read the data we have", and callers must not persist a capture where it is
   * above zero.
   */
  unreadableKeys: number;
}

/** Captures only CareDesk business data; UI preferences remain device-local. */
export function captureMvpWorkspace(): MvpWorkspaceCapture {
  if (!isBrowser()) return { schemaVersion: 1, entries: {}, unreadableKeys: 0 };
  const entries: Record<string, string> = {};
  let unreadableKeys = 0;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(MVP_STORAGE_PREFIX)) continue;
    const value = readBusinessItem(key);
    if (value === null) {
      // Previously this became '' and was uploaded as if it were the
      // customer's real, now-blank record. A failed read is not a deletion:
      // the key is omitted and reported so the caller can refuse to save.
      unreadableKeys += 1;
      continue;
    }
    entries[key] = value;
  }
  return { schemaVersion: 1, entries, unreadableKeys };
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
