import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllFormDrafts,
  clearFormDraft,
  DRAFT_MAX_AGE_MS,
  DraftStorageError,
  formDraftKey,
  readFormDraft,
  saveFormDraft,
} from './form-draft-store.js';

// Constitution §16: synthetic data only.
const SAMPLE = { baseSalary: '7000', workDays: '26' };
const SAVED_AT = '2026-08-01T10:00:00.000Z';

describe('form draft store', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
  });

  it('round-trips a draft', () => {
    saveFormDraft('payroll-wizard', SAMPLE, SAVED_AT);
    // Read at the instant the draft was written. This test is about the round
    // trip; the freshness window has its own test below. Reading with the real
    // clock instead made the assertion depend on the day the suite ran: the
    // hard-coded timestamp passed until 2026-08-31, exactly DRAFT_MAX_AGE_MS
    // later, and then the draft began expiring mid-test for a reason that had
    // nothing to do with the code under test.
    expect(readFormDraft<typeof SAMPLE>('payroll-wizard', Date.parse(SAVED_AT))).toEqual({
      savedAt: SAVED_AT,
      value: SAMPLE,
    });
  });

  /**
   * ADR-006 clause 5 freezes the MVP workspace payload and
   * scripts/check-adr-006-freeze.mjs fails `pnpm lint` on any new
   * `caredesk.mvp.*` key. Drafts are new data, so they must not live there —
   * and separately, `replaceMvpWorkspace` wipes every `caredesk.mvp.*` key on
   * each server hydration, which would destroy the very draft that has to
   * survive.
   */
  it('never writes into the frozen caredesk.mvp.* namespace', () => {
    saveFormDraft('payroll-wizard', SAMPLE);
    const keys = Object.keys(localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^caredesk\.draft\./);
    expect(keys.some((key) => key.startsWith('caredesk.mvp.'))).toBe(false);
  });

  it('stores the value encrypted, not as readable salary figures', () => {
    saveFormDraft('payroll-wizard', SAMPLE);
    const raw = localStorage.getItem(formDraftKey('payroll-wizard'))!;
    expect(raw).toContain('caredesk-encrypted-v1:');
    expect(raw).not.toContain('7000');
  });

  it('scopes the draft to the employer whose screen produced it', () => {
    history.replaceState({}, '', '/clients/client-1/payroll');
    saveFormDraft('payroll-wizard', SAMPLE);
    expect(formDraftKey('payroll-wizard')).toBe('caredesk.draft.payroll-wizard.v1.client.client-1');

    history.replaceState({}, '', '/clients/client-2/payroll');
    expect(readFormDraft('payroll-wizard')).toBeNull();
  });

  it('discards a draft nobody came back to', () => {
    const savedAt = new Date(Date.now() - DRAFT_MAX_AGE_MS - 1_000).toISOString();
    saveFormDraft('payroll-wizard', SAMPLE, savedAt);
    expect(readFormDraft('payroll-wizard')).toBeNull();
    expect(localStorage.getItem(formDraftKey('payroll-wizard'))).toBeNull();
  });

  /**
   * WEB-06: `localStorage.setItem` throws QuotaExceededError when the origin
   * quota is exhausted and throws outright in Safari private browsing. Before
   * this change that throw propagated out of a React event handler and React
   * unmounted the entire tree.
   */
  it('turns a refused write into a typed error instead of an uncaught throw', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      expect(() => saveFormDraft('payroll-wizard', SAMPLE)).toThrow(DraftStorageError);
    } finally {
      setItem.mockRestore();
    }
  });

  it('survives an unreadable draft rather than taking the screen down', () => {
    localStorage.setItem(formDraftKey('payroll-wizard'), 'caredesk-encrypted-v1:not:valid');
    expect(readFormDraft('payroll-wizard')).toBeNull();
  });

  it('clears one draft and all drafts', () => {
    saveFormDraft('payroll-wizard', SAMPLE);
    saveFormDraft('other-form', SAMPLE);
    clearFormDraft('payroll-wizard');
    expect(readFormDraft('payroll-wizard')).toBeNull();
    expect(readFormDraft('other-form')).not.toBeNull();

    clearAllFormDrafts();
    expect(readFormDraft('other-form')).toBeNull();
  });
});
