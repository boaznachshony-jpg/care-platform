import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, importNationalInsuranceReport } from '../api/client.js';
import { readMvpEmploymentExpenses, type MvpEmploymentExpense } from '../storage/mvp-storage.js';
import {
  hasHydratedWorkspaceThisSession,
  WORKSPACE_SYNC_CHANGED,
} from '../storage/workspace-sync.js';
import type { CaseLookupState } from './use-case-for-legacy-client.js';

/**
 * R5-09, stage 2 - copy each saved National Insurance report to its canonical
 * table (migration 0049). Design: docs/governance/R5-09-NATIONAL-INSURANCE-
 * REPORT-TABLE.md.
 *
 * DATA SAFETY: a strictly additive side effect, like legacy-upload.ts. Nothing
 * here changes or removes the payment or its lines in the workspace; until
 * stage 3 the workspace stays the only write authority and the server holds a
 * copy. The server is idempotent on the payment id and never deletes a month.
 *
 * WHEN IT RUNS: only for a client linked to a canonical case, and only after
 * this session has loaded the workspace from the server - otherwise a device
 * could send an older local copy than the account holds.
 *
 * WHAT IS RE-SENT: a payment whose lines or due date changed since this
 * browser last copied it. The marker below stores a fingerprint, not the
 * figures, so plain localStorage holds nothing about wages. A lost marker
 * (another device, cleared storage) only costs a repeat the server answers
 * with "unchanged".
 */

const MARKER_PREFIX = 'caredesk.sync.ni-report-copy.v1.';

type CopyInput = Pick<MvpEmploymentExpense, 'id' | 'dueDate' | 'nationalInsuranceMonths'>;

/** FNV-1a over the copied fields: enough to notice a change, useless for reading one. */
function fingerprintOf(expense: CopyInput): string {
  const text = JSON.stringify([expense.dueDate, expense.nationalInsuranceMonths ?? []]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function readMarkers(caseId: string): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MARKER_PREFIX + caseId) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMarker(caseId: string, expenseId: string, fingerprint: string): void {
  const markers = readMarkers(caseId);
  markers[expenseId] = fingerprint;
  try {
    window.localStorage.setItem(MARKER_PREFIX + caseId, JSON.stringify(markers));
  } catch {
    // A marker that cannot be written only means a repeat copy next time,
    // which the server answers with "unchanged".
  }
}

/**
 * Not a failure of the copy: the account may not write payroll (a viewer) or
 * is frozen. The data is untouched in the workspace, and an owner's or
 * manager's session copies it.
 */
function isGate(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 403 || error.status === 402);
}

const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface NationalInsuranceCopyOutcome {
  attempted: number;
  copied: number;
  failed: number;
}

/** One at a time, like legacy-upload.ts: a family has a handful of these a year. */
export async function copyNationalInsuranceReports(
  caseId: string,
  expenses: readonly CopyInput[],
  importOne: typeof importNationalInsuranceReport = importNationalInsuranceReport,
): Promise<NationalInsuranceCopyOutcome> {
  const markers = readMarkers(caseId);
  const pending = expenses.filter(
    (expense) =>
      (expense.nationalInsuranceMonths?.length ?? 0) > 0 &&
      markers[expense.id] !== fingerprintOf(expense),
  );
  const outcome: NationalInsuranceCopyOutcome = { attempted: pending.length, copied: 0, failed: 0 };
  for (const expense of pending) {
    if (!DUE_DATE.test(expense.dueDate)) {
      outcome.failed += 1;
      continue;
    }
    try {
      await importOne(caseId, {
        legacyExpenseId: expense.id,
        dueDate: expense.dueDate,
        months: expense.nationalInsuranceMonths ?? [],
      });
      writeMarker(caseId, expense.id, fingerprintOf(expense));
      outcome.copied += 1;
    } catch (error) {
      if (!isGate(error)) outcome.failed += 1;
    }
  }
  return outcome;
}

/**
 * Runs the copy for the payroll screen and reports how many payments could not
 * be copied, so the screen can say so (CLAUDE.md §2: a failed write is shown).
 * Re-runs when the case resolves, when the workspace finishes loading, when
 * the saved payments change, and on retry.
 *
 * `changed` is only a trigger. What is copied is read from storage at copy
 * time: the screen's own list was read when it opened, possibly before the
 * workspace finished loading from the server, and copying it then would send
 * exactly the older local copy the hydration rule exists to keep out.
 */
export function useNationalInsuranceReportCopy(
  caseLookup: CaseLookupState,
  changed: unknown,
  readCurrent: () => readonly CopyInput[] = readMvpEmploymentExpenses,
): { failedCount: number; retry: () => void } {
  const [hydrated, setHydrated] = useState(hasHydratedWorkspaceThisSession);
  const [attempt, setAttempt] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    const update = () => setHydrated(hasHydratedWorkspaceThisSession());
    window.addEventListener(WORKSPACE_SYNC_CHANGED, update);
    return () => window.removeEventListener(WORKSPACE_SYNC_CHANGED, update);
  }, []);

  useEffect(() => {
    if (caseLookup.status !== 'found' || !hydrated) return;
    let active = true;
    void copyNationalInsuranceReports(caseLookup.caseId, readCurrent()).then((outcome) => {
      if (active) setFailedCount(outcome.failed);
    });
    return () => {
      active = false;
    };
  }, [caseLookup, hydrated, changed, attempt, readCurrent]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return { failedCount, retry };
}
