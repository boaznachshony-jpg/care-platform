import { describe, expect, it } from 'vitest';
import {
  hashInvitationToken,
  invitationTokenMatches,
  WORKER_REQUEST_TRANSITIONS,
} from './wave5-service.js';

describe('Wave 5 security primitives', () => {
  it('stores invitation tokens as one-way SHA-256 digests and compares safely', () => {
    const token = 'synthetic-single-purpose-token-with-enough-entropy';
    const digest = hashInvitationToken(token);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
    expect(invitationTokenMatches(token, digest)).toBe(true);
    expect(invitationTokenMatches(`${token}x`, digest)).toBe(false);
    expect(invitationTokenMatches(token, 'malformed')).toBe(false);
  });

  it('does not allow terminal request states to be reopened', () => {
    expect(WORKER_REQUEST_TRANSITIONS.resolved).toEqual([]);
    expect(WORKER_REQUEST_TRANSITIONS.cancelled).toEqual([]);
    expect(WORKER_REQUEST_TRANSITIONS.rejected).not.toContain('approved');
  });
});
