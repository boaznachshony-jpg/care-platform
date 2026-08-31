import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmploymentCaseResponse } from '@caredesk/schemas';

vi.mock('./api/client.js', () => ({
  listEmploymentCases: vi.fn(),
  openEmploymentCase: vi.fn(),
}));

import { listEmploymentCases, openEmploymentCase } from './api/client.js';
import {
  caseRequestFromProfile,
  ensureCanonicalCase,
  findCanonicalCase,
  LEGACY_UNSCOPED_CLIENT_ID,
} from './canonical-case.js';
import { emptyMvpProfile, type MvpProfile } from './storage/mvp-storage.js';

const COMPLETE_PROFILE: MvpProfile = {
  ...emptyMvpProfile,
  recipientName: 'רות כהן',
  recipientCareLevel: 'רמה 5',
  recipientCity: 'חיפה',
  employerName: 'דנה כהן',
  employerRelationship: 'בת',
  employerCity: 'חיפה',
  caregiverName: 'Ana Reyes',
  caregiverCountry: 'הפיליפינים',
  caregiverLanguage: 'אנגלית',
  employmentStartDate: '2026-03-01',
  onboardingCompleted: true,
};

function caseResponse(overrides: Partial<EmploymentCaseResponse> = {}): EmploymentCaseResponse {
  return {
    id: 'case-1',
    status: 'draft',
    startDate: '2026-03-01',
    endDate: null,
    legacyClientId: null,
    careRecipient: { id: 'r-1', fullName: 'רות כהן', careLevel: null, city: null },
    employer: { id: 'e-1', fullName: 'דנה כהן', relationshipToRecipient: 'בת', city: null },
    caregiver: {
      id: 'g-1',
      legalName: 'Ana Reyes',
      preferredName: null,
      nationality: 'הפיליפינים',
      primaryLanguage: null,
    },
    ...overrides,
  };
}

describe('canonical-case', () => {
  beforeEach(() => {
    vi.mocked(listEmploymentCases).mockReset();
    vi.mocked(openEmploymentCase).mockReset();
  });

  describe('findCanonicalCase', () => {
    it('matches on the canonical link, not on position in the list', async () => {
      vi.mocked(listEmploymentCases).mockResolvedValue([
        caseResponse({ id: 'case-other', legacyClientId: 'client-b' }),
        caseResponse({ id: 'case-mine', legacyClientId: 'client-a' }),
      ]);

      expect((await findCanonicalCase('client-a'))?.id).toBe('case-mine');
    });

    it('does not claim a case that predates the link', async () => {
      // Every case created before migration 0042 carries legacyClientId null.
      // Adopting one of them for whichever client happens to be open would
      // attach a household to a case that was never theirs.
      vi.mocked(listEmploymentCases).mockResolvedValue([caseResponse({ legacyClientId: null })]);

      expect(await findCanonicalCase('client-a')).toBeNull();
    });
  });

  describe('caseRequestFromProfile', () => {
    it('maps the setup profile onto the canonical open-case contract', () => {
      const request = caseRequestFromProfile(COMPLETE_PROFILE, 'client-a', 'מעסיק');

      expect(request).toEqual({
        careRecipient: { fullName: 'רות כהן', careLevel: 'רמה 5', city: 'חיפה' },
        employer: { fullName: 'דנה כהן', relationshipToRecipient: 'בת', city: 'חיפה' },
        caregiver: {
          legalName: 'Ana Reyes',
          nationality: 'הפיליפינים',
          primaryLanguage: 'אנגלית',
        },
        startDate: '2026-03-01',
        legacyClientId: 'client-a',
      });
    });

    it('refuses to invent the five facts the canonical contract requires', () => {
      for (const missing of [
        'recipientName',
        'employerName',
        'caregiverName',
        'caregiverCountry',
        'employmentStartDate',
      ] as const) {
        expect(
          caseRequestFromProfile({ ...COMPLETE_PROFILE, [missing]: '' }, 'client-a', 'מעסיק'),
        ).toBeNull();
      }
    });

    it('supplies a truthful fallback for the optional relationship, not a guess', () => {
      const request = caseRequestFromProfile(
        { ...COMPLETE_PROFILE, employerRelationship: '' },
        'client-a',
        'מעסיק',
      );
      // The relationship is optional during setup and required by the contract.
      // "מעסיק" states the relationship the case itself establishes; it does
      // not invent a family tie the user never gave.
      expect(request?.employer.relationshipToRecipient).toBe('מעסיק');
    });
  });

  describe('ensureCanonicalCase', () => {
    it('opens a case linked to the client when there is none', async () => {
      vi.mocked(listEmploymentCases).mockResolvedValue([]);
      vi.mocked(openEmploymentCase).mockResolvedValue(
        caseResponse({ id: 'case-new', legacyClientId: 'client-a' }),
      );

      const result = await ensureCanonicalCase('client-a', 'מעסיק', COMPLETE_PROFILE);

      expect(result).toEqual({
        kind: 'linked',
        employmentCase: expect.objectContaining({ id: 'case-new' }),
      });
      expect(vi.mocked(openEmploymentCase).mock.calls[0]?.[0]).toMatchObject({
        legacyClientId: 'client-a',
      });
    });

    it('returns the existing case without opening a second one', async () => {
      vi.mocked(listEmploymentCases).mockResolvedValue([
        caseResponse({ id: 'case-existing', legacyClientId: 'client-a' }),
      ]);

      const result = await ensureCanonicalCase('client-a', 'מעסיק', COMPLETE_PROFILE);

      expect(result).toEqual({
        kind: 'linked',
        employmentCase: expect.objectContaining({ id: 'case-existing' }),
      });
      expect(openEmploymentCase).not.toHaveBeenCalled();
    });

    it('reports incomplete setup instead of posting an unusable request', async () => {
      vi.mocked(listEmploymentCases).mockResolvedValue([]);

      const result = await ensureCanonicalCase('client-a', 'מעסיק', {
        ...COMPLETE_PROFILE,
        caregiverName: '',
      });

      expect(result).toEqual({ kind: 'incomplete' });
      expect(openEmploymentCase).not.toHaveBeenCalled();
    });

    it('never throws when the server is unreachable', async () => {
      // Finishing setup must work offline. A failure here is retried the next
      // time the user opens the binder or /cases/new, and costs them nothing.
      vi.mocked(listEmploymentCases).mockRejectedValue(new Error('offline'));

      await expect(ensureCanonicalCase('client-a', 'מעסיק', COMPLETE_PROFILE)).resolves.toEqual({
        kind: 'unavailable',
      });
      expect(openEmploymentCase).not.toHaveBeenCalled();
    });

    it('reports unavailable, not success, when the case cannot be created', async () => {
      vi.mocked(listEmploymentCases).mockResolvedValue([]);
      vi.mocked(openEmploymentCase).mockRejectedValue(new Error('offline'));

      await expect(ensureCanonicalCase('client-a', 'מעסיק', COMPLETE_PROFILE)).resolves.toEqual({
        kind: 'unavailable',
      });
    });

    it('gives the unscoped legacy workspace a stable identity of its own', async () => {
      // Workspaces that predate caredesk.mvp.clients.v1 have no client id in
      // the path. Without a stable stand-in the idempotence check has nothing
      // to match on and every retry opens another case.
      vi.mocked(listEmploymentCases).mockResolvedValue([]);
      vi.mocked(openEmploymentCase).mockResolvedValue(caseResponse());

      await ensureCanonicalCase(LEGACY_UNSCOPED_CLIENT_ID, 'מעסיק', COMPLETE_PROFILE);

      expect(vi.mocked(openEmploymentCase).mock.calls[0]?.[0]).toMatchObject({
        legacyClientId: 'legacy:unscoped',
      });
    });
  });
});
