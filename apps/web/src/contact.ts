import { API_BASE_URL } from './api/client.js';

export const SUPPORT_MESSAGE_MAX_LENGTH = 500;
export const SUPPORT_MESSAGE_MIN_LENGTH = 10;

export type SupportRequestKind = 'help' | 'feedback';

export interface SupportRequest {
  kind: SupportRequestKind;
  replyEmail: string;
  message: string;
  /** Honeypot: real users never see or populate this field. */
  website?: string;
}

export async function submitSupportRequest(request: SupportRequest): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/support/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('SUPPORT_REQUEST_FAILED');
  }
}
