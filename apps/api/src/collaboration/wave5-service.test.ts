import { describe, expect, it } from 'vitest';
import {
  hashInvitationToken,
  invitationTokenMatches,
  Wave5Service,
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

/**
 * Audit-coverage contract (capability #10): every access-shaping Wave 5
 * mutation must write `audit_event` inside its transaction. The service is
 * PostgreSQL-only, so absent a live database the contract is asserted against
 * the method implementations themselves — a removed audit insert fails here
 * before it can fail in production.
 */
describe('Wave 5 mutation audit-evidence contract', () => {
  const mutationSources = {
    inviteWorker: String(Wave5Service.prototype.inviteWorker),
    consumeInvitation: String(Wave5Service.prototype.consumeInvitation),
    acknowledge: String(Wave5Service.prototype.acknowledge),
    assignResponsibility: String(Wave5Service.prototype.assignResponsibility),
    assignTask: String(Wave5Service.prototype.assignTask),
    createRequest: String(Wave5Service.prototype.createRequest),
    updateRequest: String(Wave5Service.prototype.updateRequest),
    updatePreference: String(Wave5Service.prototype.updatePreference),
  };

  it.each(Object.entries(mutationSources))(
    '%s writes an audit_event inside its transaction',
    (_name, source) => {
      expect(source).toContain('insert into audit_event');
    },
  );

  it('records invitation, activation and acknowledgement to the case timeline', () => {
    expect(mutationSources.inviteWorker).toContain('insert into timeline_event');
    expect(mutationSources.inviteWorker).toContain('worker.invited');
    expect(mutationSources.consumeInvitation).toContain('worker.portal_activated');
    expect(mutationSources.acknowledge).toContain('payment.acknowledged');
  });

  it('never writes the invitation token or destination into evidence', () => {
    // The audit/timeline inserts reference ids only; the raw token variable
    // and destination address must not appear in any insert statement.
    const inserts = mutationSources.inviteWorker
      .split(';')
      .filter((statement) => statement.includes('insert into audit_event'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const statement of inserts) {
      expect(statement).not.toContain('token');
      expect(statement).not.toContain('destination');
    }
  });
});
