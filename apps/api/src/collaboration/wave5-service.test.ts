import { describe, expect, it } from 'vitest';
import {
  hashInvitationToken,
  invitationTokenMatches,
  mergeCollaborationMembers,
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

/**
 * Defect (compliance, highest priority): saving an unrelated preference (the
 * worker portal's language selector) always sent whatsappConsent/smsConsent
 * as 'unknown', and the upsert wrote `excluded.whatsapp_consent`
 * unconditionally — so a caregiver who had explicitly withdrawn WhatsApp/SMS
 * consent had that withdrawal silently reset the next time she changed her
 * display language.
 *
 * The server is the real guarantee here, not the client: this asserts the
 * upsert itself can never unconditionally overwrite stored consent, the same
 * way the audit-evidence contract above asserts the SQL shape directly
 * rather than trusting a live database in this test file (PostgreSQL-only,
 * no DB in this suite).
 */
describe('Wave 5 worker consent preservation contract', () => {
  const source = String(Wave5Service.prototype.updatePreference);

  it('never unconditionally overwrites stored consent with the incoming value', () => {
    expect(source).not.toContain('whatsapp_consent=excluded.whatsapp_consent');
    expect(source).not.toContain('sms_consent=excluded.sms_consent');
  });

  it('falls back to the row already on file whenever the incoming value is not an explicit revoke', () => {
    expect(source).toContain('communication_preference.whatsapp_consent');
    expect(source).toContain('communication_preference.sms_consent');
    expect(source).toContain("excluded.whatsapp_consent='revoked'");
    expect(source).toContain("excluded.sms_consent='revoked'");
  });
});

/**
 * SEC-DB-01. The collaboration read used to join `app_user`, which the
 * application role cannot see (no grant, forced RLS, no policy), so every case
 * page reported a load failure. Memberships and names now arrive from two
 * statements the role *can* run and are merged here.
 */
describe('Wave 5 collaboration members', () => {
  it('reads memberships from tenant_membership and names from the security-definer function', () => {
    const source = String(Wave5Service.prototype.collaboration);
    expect(source).not.toContain('app_user');
    expect(source).toContain('select id, role, status from tenant_membership');
    expect(source).toContain('from list_caredesk_family_members($1)');
  });

  it('keeps a revoked membership with its real status and a placeholder name', () => {
    const members = mergeCollaborationMembers(
      [
        { id: 'm-owner', role: 'owner', status: 'active' },
        { id: 'm-revoked', role: 'manager', status: 'revoked' },
        { id: 'm-email-only', role: 'viewer', status: 'active' },
      ],
      [
        { membership_id: 'm-owner', display_name: 'Synthetic Owner', email: 'owner@example.test' },
        { membership_id: 'm-email-only', display_name: null, email: 'viewer@example.test' },
      ],
    );
    expect(members).toEqual([
      { id: 'm-owner', role: 'owner', status: 'active', display_name: 'Synthetic Owner' },
      { id: 'm-revoked', role: 'manager', status: 'revoked', display_name: '—' },
      { id: 'm-email-only', role: 'viewer', status: 'active', display_name: 'viewer@example.test' },
    ]);
  });
});
