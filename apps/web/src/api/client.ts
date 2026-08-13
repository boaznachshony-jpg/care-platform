import type {
  AddContactRequest,
  CaseContactResponse,
  CreateTaskRequest,
  DocumentDownloadUrlResponse,
  DocumentResponse,
  EmploymentCaseResponse,
  OpenEmploymentCaseRequest,
  TaskResponse,
  TimelineEventResponse,
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
} from '@caredesk/schemas';
import { getBrowserAuthClient } from '../auth/client.js';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  return request('/cases', { method: 'POST', body: JSON.stringify(input) });
}

export function getEmploymentCase(caseId: string): Promise<EmploymentCaseResponse> {
  return request(`/cases/${encodeURIComponent(caseId)}`);
}

export function listEmploymentCases(): Promise<EmploymentCaseResponse[]> {
  return request('/cases');
}

const casePath = (caseId: string): string => `/cases/${encodeURIComponent(caseId)}`;

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
  return request(`${casePath(caseId)}/visa-renewals`);
}

export function startVisaRenewal(
  caseId: string,
  input: StartVisaRenewalRequest,
): Promise<VisaRenewalWorkflowResponse> {
  return request(`${casePath(caseId)}/visa-renewals`, {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export function listCaseContacts(caseId: string): Promise<CaseContactResponse[]> {
  return request(`${casePath(caseId)}/contacts`);
}

export function addCaseContact(
  caseId: string,
  input: AddContactRequest,
): Promise<{ contactId: string }> {
  return request(`${casePath(caseId)}/contacts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listCaseTasks(caseId: string): Promise<TaskResponse[]> {
  return request(`${casePath(caseId)}/tasks`);
}

export function createCaseTask(caseId: string, input: CreateTaskRequest): Promise<TaskResponse> {
  return request(`${casePath(caseId)}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function completeCaseTask(caseId: string, taskId: string): Promise<TaskResponse> {
  return request(`${casePath(caseId)}/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: 'POST',
  });
}

export function listCaseTimeline(caseId: string): Promise<TimelineEventResponse[]> {
  return request(`${casePath(caseId)}/timeline`);
}

export function listCaseDocuments(caseId: string): Promise<DocumentResponse[]> {
  return request(`${casePath(caseId)}/documents`);
}

export function uploadCaseDocument(
  caseId: string,
  input: UploadDocumentRequest,
): Promise<DocumentResponse> {
  return request(`${casePath(caseId)}/documents`, {
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
  return request(`${casePath(caseId)}/documents/${encodeURIComponent(documentId)}/download-url`);
}

export function getWorkspace(): Promise<WorkspaceResponse> {
  return request('/workspace');
}

export function saveWorkspace(input: SaveWorkspaceRequest): Promise<WorkspaceResponse> {
  return request('/workspace', { method: 'PUT', body: JSON.stringify(input) });
}

const workspaceFilePath = (clientId: string, documentId: string) =>
  `/workspace/files/${encodeURIComponent(clientId)}/${encodeURIComponent(documentId)}`;

export function uploadWorkspaceFile(
  clientId: string,
  documentId: string,
  input: UploadWorkspaceFileRequest,
): Promise<{ version: number; sizeBytes: number }> {
  return request(workspaceFilePath(clientId, documentId), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function getWorkspaceFileUrl(
  clientId: string,
  documentId: string,
): Promise<WorkspaceFileUrlResponse> {
  return request(workspaceFilePath(clientId, documentId));
}

export function deleteWorkspaceFile(clientId: string, documentId: string): Promise<void> {
  return request(workspaceFilePath(clientId, documentId), { method: 'DELETE' });
}

export function listFamilyMembers(): Promise<FamilyAccessResponse> {
  return request('/family/members');
}

export function inviteFamilyMember(
  input: InviteFamilyMemberRequest,
): Promise<FamilyMemberResponse> {
  return request('/family/invitations', { method: 'POST', body: JSON.stringify(input) });
}

export function updateFamilyMemberRole(
  membershipId: string,
  input: UpdateFamilyMemberRoleRequest,
): Promise<FamilyMemberResponse> {
  return request(`/family/members/${encodeURIComponent(membershipId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function revokeFamilyMember(membershipId: string): Promise<void> {
  return request(`/family/members/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
}

export function getBillingSubscription(): Promise<BillingPlanResponse> {
  return request('/billing/subscription');
}

export function startBillingPaymentMethodSetup(
  input: StartBillingSetupRequest,
): Promise<BillingCheckoutResponse> {
  return request('/billing/payment-method/setup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelBillingSubscription(): Promise<void> {
  return request('/billing/subscription', { method: 'DELETE' });
}
