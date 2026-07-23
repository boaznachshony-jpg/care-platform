import type { EmploymentCaseResponse, OpenEmploymentCaseRequest } from '@caredesk/schemas';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
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
