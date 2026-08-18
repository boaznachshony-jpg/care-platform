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
} from '@caredesk/schemas';

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${DEV_TOKEN}`,
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
