import type {
  AddContactRequest,
  CaseContactResponse,
  CreateMedicationRequest,
  CreateTaskRequest,
  DocumentDownloadUrlResponse,
  DocumentResponse,
  EmploymentCaseResponse,
  ImportDocumentRequest,
  ImportMedicationRequest,
  ImportTaskRequest,
  MedicationResponse,
  OpenEmploymentCaseRequest,
  TaskResponse,
  TimelineEventResponse,
  UpdateMedicationRequest,
  UpdateTaskRequest,
  UploadDocumentRequest,
  SaveWorkspaceRequest,
  WorkspaceResponse,
  UploadWorkspaceFileRequest,
  WorkspaceFileUrlResponse,
  FamilyAccessResponse,
  FamilyMemberResponse,
  InviteFamilyMemberRequest,
  UpdateFamilyMemberRoleRequest,
  BillingPlanResponse,
  BillingCheckoutResponse,
  StartBillingSetupRequest,
  StartVisaRenewalRequest,
  LegalAcceptanceRequest,
  LegalAcceptanceResponse,
} from '@caredesk/schemas';
import { getBrowserAuthClient } from '../auth/client.js';
import { getDeploymentEnvironment } from '../environment.js';

const API_PORT = 4000;

/**
 * An explicit `VITE_API_BASE_URL` always wins. Otherwise the API host is
 * derived from the page's own host rather than hardcoded to localhost:
 * when the app is opened from a phone at http://192.168.x.x:5173, "localhost"
 * would mean the phone itself, so a fixed value silently breaks every request
 * on exactly the device this mobile-first product most needs testing on.
 */
function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  if (typeof window === 'undefined') {
    return `http://localhost:${API_PORT}`;
  }
  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

/**
 * WEB-20: the `:4000`-on-the-page's-own-host fallback is correct for a phone
 * pointed at a dev machine and catastrophic anywhere else — a deploy that
 * forgets VITE_API_BASE_URL sends every authenticated request to
 * `https://<the site>:4000`, which never answers. The user then saw a generic
 * "cloud save failed" banner with a retry that could never succeed.
 *
 * This is a configuration fault, not a transient one, so it is reported as
 * itself. Exported as a function (not a constant) so a test can vary the
 * hostname; the env var is read once at module load, as Vite inlines it.
 */
export function apiBaseUrlIsMisconfigured(
  environment = typeof window === 'undefined' ? 'local' : getDeploymentEnvironment(),
): boolean {
  return !import.meta.env.VITE_API_BASE_URL && environment !== 'local';
}

const API_PREWARM_TTL_MS = 60_000;
let apiWarmUntil = 0;
let apiWarmupInFlight: Promise<void> | undefined;

/**
 * Starts the public API instance before an authenticated workspace request is
 * needed. This request carries no token or customer data; it only calls the
 * public health endpoint so a cold deployment can wake while the user signs
 * in. Concurrent calls are coalesced and a recent successful warm-up is reused.
 */
export function prewarmApi(): Promise<void> {
  if (Date.now() < apiWarmUntil) return Promise.resolve();
  if (apiWarmupInFlight) return apiWarmupInFlight;

  const warmup = fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    cache: 'no-store',
  })
    .then((response) => {
      if (response.ok) apiWarmUntil = Date.now() + API_PREWARM_TTL_MS;
    })
    .catch(() => undefined)
    .finally(() => {
      if (apiWarmupInFlight === warmup) apiWarmupInFlight = undefined;
    });

  apiWarmupInFlight = warmup;
  return warmup;
}

export function resetApiPrewarmForTests(): void {
  apiWarmUntil = 0;
  apiWarmupInFlight = undefined;
}

/**
 * Development-only bearer token matching apps/api's synthetic dev session —
 * not a secret (mock session over synthetic data; never seeded in
 * production). Real session handling arrives with Supabase Auth (ADR-001).
 */
const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN ?? 'dev-local-token';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(code);
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined;
  const authClient = getBrowserAuthClient();
  const accessToken = authClient
    ? (await authClient.auth.getSession()).data.session?.access_token
    : DEV_TOKEN;
  if (!accessToken) {
    throw new ApiRequestError(401, 'UNAUTHENTICATED');
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      fieldErrors?: Record<string, string[]>;
    };
    throw new ApiRequestError(response.status, body.code ?? 'REQUEST_ERROR', body.fieldErrors);
  }

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export function openEmploymentCase(
  input: OpenEmploymentCaseRequest,
): Promise<EmploymentCaseResponse> {
  return apiRequest('/cases', { method: 'POST', body: JSON.stringify(input) });
}

export function getEmploymentCase(caseId: string): Promise<EmploymentCaseResponse> {
  return apiRequest(`/cases/${encodeURIComponent(caseId)}`);
}

export function listEmploymentCases(): Promise<EmploymentCaseResponse[]> {
  return apiRequest('/cases');
}

const casePath = (caseId: string): string => `/cases/${encodeURIComponent(caseId)}`;

/**
 * Idempotency keys only need to be unique, not secret. `crypto.randomUUID`
 * exists only in secure contexts, and this app is deliberately reachable over
 * plain http on a phone at 192.168.x.x, where a bare `crypto.randomUUID()`
 * throws before any request is sent and the action fails with no error shown
 * (the exact bug `EmergencyBinderPage` hit first). The fallback below keeps
 * every idempotency-bearing action working on exactly the device this
 * mobile-first product most needs testing on.
 *
 * Callers that need retry-safety (the same logical attempt must reuse the
 * same key so a lost response and a second press don't create a duplicate)
 * should generate one key once — e.g. with `useMemo` keyed on the form
 * inputs — and pass it explicitly instead of relying on the default.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export interface VisaRenewalWorkflowResponse {
  id: string;
  employmentCaseId: string;
  templateVersionId: string;
  currentAuthorizationId: string;
  status: 'not_started' | 'active' | 'blocked' | 'completed' | 'cancelled';
  evaluation: {
    status: 'active' | 'unverified' | 'conflicting' | 'unavailable';
    asOf: string;
    dueDate: string | null;
    priority: 'low' | 'normal' | 'high' | 'urgent' | null;
    explanationKey: string;
    sourceReferences: readonly string[];
    reviewRequired: boolean;
  };
  assignments: readonly {
    stepKey: string;
    raciRole: 'responsible' | 'accountable' | 'consulted' | 'informed';
    assigneeType: 'user' | 'contact';
    assigneeId: string;
  }[];
  blockers: readonly {
    code:
      | 'missing_primary_licensed_bureau_contact'
      | 'overlapping_authorization'
      | 'unverified_evidence'
      | 'professional_review_required';
    stepKey: string;
    ownerAssignmentId: string | null;
    nextReviewAt: string | null;
  }[];
  linkedRenewedAuthorizationId: string | null;
  linkedDocumentVersionId: string | null;
  completedAt: string | null;
}

export function listVisaRenewals(caseId: string): Promise<VisaRenewalWorkflowResponse[]> {
  return apiRequest(`${casePath(caseId)}/visa-renewals`);
}

export function startVisaRenewal(
  caseId: string,
  input: StartVisaRenewalRequest,
  // Defaults to a fresh key for callers that don't pass one yet; a caller
  // that wants retry-safety across a lost response should pass a key it
  // generated once for this attempt (see `newIdempotencyKey`).
  idempotencyKey: string = newIdempotencyKey(),
): Promise<VisaRenewalWorkflowResponse> {
  return apiRequest(`${casePath(caseId)}/visa-renewals`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });
}

export function listCaseContacts(caseId: string): Promise<CaseContactResponse[]> {
  return apiRequest(`${casePath(caseId)}/contacts`);
}

export function addCaseContact(
  caseId: string,
  input: AddContactRequest,
): Promise<{ contactId: string }> {
  return apiRequest(`${casePath(caseId)}/contacts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listCaseTasks(caseId: string): Promise<TaskResponse[]> {
  return apiRequest(`${casePath(caseId)}/tasks`);
}

export function createCaseTask(caseId: string, input: CreateTaskRequest): Promise<TaskResponse> {
  return apiRequest(`${casePath(caseId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function completeCaseTask(caseId: string, taskId: string): Promise<TaskResponse> {
  return apiRequest(`${casePath(caseId)}/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: 'POST',
  });
}

export function updateCaseTask(
  caseId: string,
  taskId: string,
  input: UpdateTaskRequest,
): Promise<TaskResponse> {
  return apiRequest(`${casePath(caseId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Soft-close only (status -> 'cancelled'); there is no delete route for tasks. */
export function archiveCaseTask(caseId: string, taskId: string): Promise<TaskResponse> {
  return apiRequest(`${casePath(caseId)}/tasks/${encodeURIComponent(taskId)}/archive`, {
    method: 'POST',
  });
}

/**
 * Idempotent upload of one browser-only task (MVP cutover). The server keys
 * idempotency on `input.legacyLocalId` (migration 0046): calling this twice
 * with the same id returns the same task rather than creating a duplicate,
 * which is what makes it safe to call from a background sync effect without
 * first checking whether a previous attempt already succeeded.
 */
export function importCaseTask(caseId: string, input: ImportTaskRequest): Promise<TaskResponse> {
  return apiRequest(`${casePath(caseId)}/tasks/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type CanonicalTimelineEvent = TimelineEventResponse & {
  /** Server-derived allowlisted destination; never an arbitrary browser URL. */
  actionTarget?: '/documents' | '/tasks' | '/payroll';
};

export function listCaseTimeline(caseId: string): Promise<CanonicalTimelineEvent[]> {
  return apiRequest(`${casePath(caseId)}/timeline`);
}

export function listCaseDocuments(caseId: string): Promise<DocumentResponse[]> {
  return apiRequest(`${casePath(caseId)}/documents`);
}

export function uploadCaseDocument(
  caseId: string,
  input: UploadDocumentRequest,
): Promise<DocumentResponse> {
  return apiRequest(`${casePath(caseId)}/documents`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Fetches a short-lived signed link. The link is never rendered as a bare href
 * in the list — it is requested at the moment the user asks to open the file,
 * so an expired or unauthorized link is never sitting in the DOM.
 */
export function getCaseDocumentDownloadUrl(
  caseId: string,
  documentId: string,
): Promise<DocumentDownloadUrlResponse> {
  return apiRequest(`${casePath(caseId)}/documents/${encodeURIComponent(documentId)}/download-url`);
}

/**
 * Idempotent upload of one browser-only document record (MVP cutover), keyed
 * on `input.legacyLocalId` the same way {@link importCaseTask} is (migration
 * 0046). `input.file` is omitted for a local record that never had a scanned
 * file — the import still creates the document, with no version, exactly as
 * `ImportCaseDocument` documents.
 */
export function importCaseDocument(
  caseId: string,
  input: ImportDocumentRequest,
): Promise<DocumentResponse> {
  return apiRequest(`${casePath(caseId)}/documents/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listCaseMedications(caseId: string): Promise<MedicationResponse[]> {
  return apiRequest(`${casePath(caseId)}/medications`);
}

export function createCaseMedication(
  caseId: string,
  input: CreateMedicationRequest,
): Promise<MedicationResponse> {
  return apiRequest(`${casePath(caseId)}/medications`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Idempotent upload of one browser-only medication (MVP cutover) — see importCaseTask. */
export function importCaseMedication(
  caseId: string,
  input: ImportMedicationRequest,
): Promise<MedicationResponse> {
  return apiRequest(`${casePath(caseId)}/medications/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCaseMedication(
  caseId: string,
  medicationId: string,
  input: UpdateMedicationRequest,
): Promise<MedicationResponse> {
  return apiRequest(`${casePath(caseId)}/medications/${encodeURIComponent(medicationId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Soft-close only (status -> 'archived'); there is no delete route for medications. */
export function archiveCaseMedication(
  caseId: string,
  medicationId: string,
): Promise<MedicationResponse> {
  return apiRequest(`${casePath(caseId)}/medications/${encodeURIComponent(medicationId)}/archive`, {
    method: 'POST',
  });
}

export function getWorkspace(): Promise<WorkspaceResponse> {
  return apiRequest('/workspace');
}

export function saveWorkspace(input: SaveWorkspaceRequest): Promise<WorkspaceResponse> {
  return apiRequest('/workspace', { method: 'PUT', body: JSON.stringify(input) });
}

const workspaceFilePath = (clientId: string, documentId: string) =>
  `/workspace/files/${encodeURIComponent(clientId)}/${encodeURIComponent(documentId)}`;

export function uploadWorkspaceFile(
  clientId: string,
  documentId: string,
  input: UploadWorkspaceFileRequest,
): Promise<{ version: number; sizeBytes: number }> {
  return apiRequest(workspaceFilePath(clientId, documentId), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function getWorkspaceFileUrl(
  clientId: string,
  documentId: string,
): Promise<WorkspaceFileUrlResponse> {
  return apiRequest(workspaceFilePath(clientId, documentId));
}

export function deleteWorkspaceFile(clientId: string, documentId: string): Promise<void> {
  return apiRequest(workspaceFilePath(clientId, documentId), { method: 'DELETE' });
}

export function listFamilyMembers(): Promise<FamilyAccessResponse> {
  return apiRequest('/family/members');
}

export function inviteFamilyMember(
  input: InviteFamilyMemberRequest,
): Promise<FamilyMemberResponse> {
  return apiRequest('/family/invitations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateFamilyMemberRole(
  membershipId: string,
  input: UpdateFamilyMemberRoleRequest,
): Promise<FamilyMemberResponse> {
  return apiRequest(`/family/members/${encodeURIComponent(membershipId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function revokeFamilyMember(membershipId: string): Promise<void> {
  return apiRequest(`/family/members/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
}

export function getBillingSubscription(): Promise<BillingPlanResponse> {
  return apiRequest('/billing/subscription');
}

export function startBillingPaymentMethodSetup(
  input: StartBillingSetupRequest,
): Promise<BillingCheckoutResponse> {
  return apiRequest('/billing/payment-method/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelBillingSubscription(): Promise<void> {
  return apiRequest('/billing/subscription', { method: 'DELETE' });
}

/**
 * Records that the signed-in user accepted the terms of service and the privacy
 * policy, at the versions they were shown (migration 0043, `terms_acceptance`).
 *
 * The version comes from `@caredesk/i18n`, which is also what renders the
 * version line at the top of /terms and /privacy, so the recorded string is by
 * construction the string the user saw. The call is idempotent: accepting the
 * same version twice records one row.
 */
export function recordLegalAcceptance(
  input: LegalAcceptanceRequest,
): Promise<LegalAcceptanceResponse> {
  return apiRequest('/legal/acceptances', { method: 'POST', body: JSON.stringify(input) });
}

export function listLegalAcceptances(): Promise<LegalAcceptanceResponse> {
  return apiRequest('/legal/acceptances');
}

export interface CaseHealthResponse {
  score: number;
  actionsRemaining: number;
  disclaimer: string;
  factors: Array<{
    id: string;
    title: string;
    status: 'good' | 'attention' | 'not_applicable';
    points: number;
    weight: number;
    explanation: string;
    recommendedAction?: string;
    actionTarget?: string;
    provenance: { sourceType: string; sourceIds: string[] };
  }>;
}
export interface AssistantResponse {
  answer: string;
  groundingLabel: string;
  factsUsed: Array<{ factPath: string; label: string }>;
  uncertainties: Array<{ code: string; message: string }>;
  proposedChecklist?: string[];
  escalation?: { required: boolean; reason: string };
}
export type ProfessionalReviewStatus =
  'requested' | 'acknowledged' | 'in_review' | 'resolved' | 'cancelled';
export interface ProfessionalReviewResponse {
  id: string;
  category: string;
  reason: string;
  summary: string;
  source: string;
  status: ProfessionalReviewStatus;
  assignedTo?: string | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}
export interface ProfessionalReviewTransitionResponse {
  id: string;
  fromStatus: ProfessionalReviewStatus;
  toStatus: ProfessionalReviewStatus;
  changedBy: string;
  assignedTo?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
}
export interface ProfessionalReviewDetailResponse {
  review: ProfessionalReviewResponse;
  history: ProfessionalReviewTransitionResponse[];
}
export const getCaseHealth = (caseId: string) =>
  apiRequest<CaseHealthResponse>(`${casePath(caseId)}/health`);
export interface CanonicalPayrollClose {
  id: string;
  payrollReference: string;
  month: string;
  paymentDate: string;
  paymentMethod: 'bank_transfer' | 'cash' | 'check' | 'other';
  total: number | null;
  baseSalary: number | null;
  additions: number | null;
  deductions: number | null;
  closedAt: string;
}
export const listCanonicalPayrollCloses = (caseId: string) =>
  apiRequest<CanonicalPayrollClose[]>(`${casePath(caseId)}/payroll-month-closes`);
export const closeCanonicalPayrollMonth = (
  caseId: string,
  input: Omit<
    CanonicalPayrollClose,
    'id' | 'closedAt' | 'total' | 'baseSalary' | 'additions' | 'deductions'
  > & { total: number; baseSalary: number; additions: number; deductions: number },
  idempotencyKey: string,
) =>
  apiRequest<{ close: CanonicalPayrollClose; replayed: boolean }>(
    `${casePath(caseId)}/payroll-month-closes`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
export const askCaseAssistant = (
  caseId: string,
  question: string,
  intent: 'travel_check' | 'missing_file_facts' | 'explain_attention' | 'checklist',
) =>
  apiRequest<AssistantResponse>(`${casePath(caseId)}/assistant`, {
    method: 'POST',
    body: JSON.stringify({ question, intent }),
  });
export const confirmAssistantChecklist = (
  caseId: string,
  items: string[],
  idempotencyKey: string = newIdempotencyKey(),
) =>
  apiRequest(`${casePath(caseId)}/assistant/checklist-confirmations`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ items }),
  });
export const listProfessionalReviews = (caseId: string) =>
  apiRequest<ProfessionalReviewResponse[]>(`${casePath(caseId)}/professional-reviews`);
export const createProfessionalReview = (
  caseId: string,
  input: { category: string; reason: string; summary: string; source: string },
  idempotencyKey: string = newIdempotencyKey(),
) =>
  apiRequest<ProfessionalReviewResponse>(`${casePath(caseId)}/professional-reviews`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });
export const getProfessionalReview = (caseId: string, reviewId: string) =>
  apiRequest<ProfessionalReviewDetailResponse>(
    `${casePath(caseId)}/professional-reviews/${reviewId}`,
  );
// Manual handoff only: assignedTo is a free-text professional name/contact.
// No provider is contacted and no fulfilment is claimed.
export const transitionProfessionalReview = (
  caseId: string,
  reviewId: string,
  input: { status: ProfessionalReviewStatus; assignedTo?: string; resolutionNote?: string },
  idempotencyKey: string = newIdempotencyKey(),
) =>
  apiRequest<ProfessionalReviewResponse>(`${casePath(caseId)}/professional-reviews/${reviewId}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });

export interface PayrollEntryResponse {
  id: string;
  month: string;
  baseSalary: number;
  workDays: number;
  paidRestDays: number;
  restDayRate: number;
  paidHolidays: number;
  holidayPay: number;
  vacationDays: number;
  vacationPay: number;
  sickDays: number;
  sickPay: number;
  otherAbsenceDays: number;
  employerContributions: number;
  additionalPayments: Array<{ description: string; amount: number }>;
  pocketMoney: number;
  deductions: number;
  advances: number;
  agreedDeductions: number;
  total: number;
  status: 'draft' | 'final';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type SavePayrollEntryRequest = Omit<
  PayrollEntryResponse,
  'id' | 'month' | 'createdAt' | 'updatedAt' | 'version'
> & { version?: number };
export function listPayrollEntries(caseId: string): Promise<PayrollEntryResponse[]> {
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/payroll-entries`);
}
export function savePayrollEntry(
  caseId: string,
  month: string,
  input: SavePayrollEntryRequest,
  idempotencyKey: string,
): Promise<{ entry: PayrollEntryResponse; replayed: boolean }> {
  return apiRequest(
    `/cases/${encodeURIComponent(caseId)}/payroll-entries/${encodeURIComponent(month)}`,
    { method: 'PUT', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(input) },
  );
}

/** Planning-only Future Cost scenario expense (canonical scenario_expense row). */
export interface ScenarioExpenseResponse {
  id: string;
  label: string;
  amount: number;
  kind: 'recurring' | 'one_time';
  startMonth: string;
  endMonth: string | null;
  status: 'active' | 'deleted';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type SaveScenarioExpenseRequest = Omit<
  ScenarioExpenseResponse,
  'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'
> & { version?: number };
export function listScenarioExpenses(caseId: string): Promise<ScenarioExpenseResponse[]> {
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/scenario-expenses`);
}
export function createScenarioExpense(
  caseId: string,
  input: SaveScenarioExpenseRequest,
  idempotencyKey: string,
): Promise<{ expense: ScenarioExpenseResponse; replayed: boolean }> {
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/scenario-expenses`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });
}
/**
 * Root 4 (API-03): `version` is required on an update. It used to be optional
 * on the client type too, which is how a browser could omit it and silently
 * overwrite whatever another manager had just saved. The server refuses a
 * versionless update with 428; the type stops it being written that way.
 */
export function updateScenarioExpense(
  caseId: string,
  expenseId: string,
  input: SaveScenarioExpenseRequest & { version: number },
  idempotencyKey: string,
): Promise<{ expense: ScenarioExpenseResponse; replayed: boolean }> {
  return apiRequest(
    `/cases/${encodeURIComponent(caseId)}/scenario-expenses/${encodeURIComponent(expenseId)}`,
    { method: 'PUT', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(input) },
  );
}
export function deleteScenarioExpense(
  caseId: string,
  expenseId: string,
  version: number,
  idempotencyKey: string,
): Promise<{ expense: ScenarioExpenseResponse; replayed: boolean }> {
  return apiRequest(
    `/cases/${encodeURIComponent(caseId)}/scenario-expenses/${encodeURIComponent(expenseId)}`,
    {
      method: 'DELETE',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ version }),
    },
  );
}

/** Explicit Emergency Binder selection — nothing is exported by implication. */
export interface BinderExportManifest {
  sections: string[];
  documentIds: string[];
}

/**
 * Durable server-side evidence of a Binder export ("אסמכתת ייצוא"): the
 * validated manifest plus a deterministic sha256 fingerprint. Never a sharing
 * link — public Binder sharing stays disabled.
 */
export interface BinderExportReceiptResponse {
  id: string;
  caseId: string;
  manifest: BinderExportManifest;
  contentHash: string;
  hashAlgorithm: 'sha256';
  createdBy: string;
  createdAt: string;
}

export function createBinderExport(
  caseId: string,
  manifest: BinderExportManifest,
  idempotencyKey: string,
): Promise<{ receipt: BinderExportReceiptResponse; replayed: boolean }> {
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/binder-exports`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(manifest),
  });
}

export function listBinderExports(caseId: string): Promise<BinderExportReceiptResponse[]> {
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/binder-exports`);
}

/**
 * Regulation Engine review lifecycle (capability #11). A rule is reviewed
 * factual content with an explicit source citation — never legal advice. Only
 * status='active' rules inside their effective window ever feed the
 * assistant/wizard context; this admin surface manages the manual lifecycle
 * draft → in_review → approved → active → retired.
 */
export type RegulationRuleStatus = 'draft' | 'in_review' | 'approved' | 'active' | 'retired';
export interface RegulationRuleResponse {
  id: string;
  ruleKey: string;
  version: number;
  title: string;
  statement: string;
  sourceCitation: string;
  sourceAuthority: string | null;
  requiresProfessionalValidation: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: RegulationRuleStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listRegulationRules(): Promise<RegulationRuleResponse[]> {
  return apiRequest('/regulation-rules');
}

export function createRegulationRule(
  input: {
    ruleKey: string;
    title: string;
    statement: string;
    sourceCitation: string;
    sourceAuthority?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  },
  idempotencyKey: string = newIdempotencyKey(),
): Promise<{ rule: RegulationRuleResponse; replayed: boolean }> {
  return apiRequest('/regulation-rules', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });
}

// Manual review lifecycle only: reviewedBy is a free-text professional name
// recorded on approval. No provider is contacted and no validation is claimed.
export function transitionRegulationRule(
  ruleId: string,
  input: { status: Exclude<RegulationRuleStatus, 'draft'>; reviewedBy?: string },
  idempotencyKey: string = newIdempotencyKey(),
): Promise<{ rule: RegulationRuleResponse; replayed: boolean }> {
  return apiRequest(`/regulation-rules/${encodeURIComponent(ruleId)}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  });
}
