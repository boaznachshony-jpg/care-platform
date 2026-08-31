import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import type { EmploymentCaseResponse } from '@caredesk/schemas';

// Canonical API mocks — the new EmergencyBinderPage reads from authenticated
// case APIs, not mvp-storage. Constitution §16: synthetic data only.
const mocks = vi.hoisted(() => ({
  createBinderExport: vi.fn(),
}));

const DEMO_CASE: EmploymentCaseResponse = {
  id: 'case-demo-001',
  careRecipient: {
    id: 'recipient-demo-001',
    fullName: 'רות כהן (הדגמה)',
    careLevel: null,
    city: null,
  },
  caregiver: {
    id: 'caregiver-demo-001',
    legalName: 'Ana Reyes',
    preferredName: 'Ana',
    nationality: 'הפיליפינים',
    primaryLanguage: null,
  },
  employer: {
    id: 'employer-demo-001',
    fullName: 'דנה כהן (הדגמה)',
    relationshipToRecipient: 'בת',
    city: null,
  },
  startDate: '2025-01-14',
  endDate: null,
  status: 'active',
  // Predates migration 0042: no link to a legacy client. Kept null on purpose
  // so the existing behaviour - the user picks - is what these tests cover.
  legacyClientId: null,
};

vi.mock('../api/client.js', () => ({
  listEmploymentCases: vi.fn(),
  listCaseDocuments: vi.fn().mockResolvedValue([
    {
      id: 'doc-demo-001',
      documentType: 'דרכון',
      status: 'valid',
      verificationStatus: 'verified',
    },
  ]),
  listCanonicalPayrollCloses: vi
    .fn()
    .mockResolvedValue([{ id: 'pay-demo-001', month: '2026-07', total: 6500 }]),
  listCaseTasks: vi.fn().mockResolvedValue([
    {
      id: 'task-demo-001',
      title: 'חידוש ביטוח (הדגמה)',
      dueAt: '2026-09-01',
      status: 'open',
    },
  ]),
  listCaseContacts: vi.fn().mockResolvedValue([
    {
      roleId: 'contact-demo-001',
      fullName: 'נציג תאגיד (הדגמה)',
      roleType: 'licensed_bureau',
      isEmergency: true,
    },
  ]),
  createBinderExport: mocks.createBinderExport,
}));

import { listEmploymentCases } from '../api/client.js';
import { EmergencyBinderPage } from './EmergencyBinderPage.js';

const DEMO_RECEIPT = {
  id: 'receipt-demo-001',
  caseId: 'case-demo-001',
  manifest: {
    sections: ['case', 'caregiver', 'medications', 'documents', 'payroll', 'tasks', 'contacts'],
    documentIds: [],
  },
  contentHash: 'ab'.repeat(32),
  hashAlgorithm: 'sha256' as const,
  createdBy: 'user-demo-001',
  createdAt: '2026-08-19T10:00:00.000Z',
};

/**
 * The binder resolves "which case is this client's?" from the path, so it needs
 * a router. `/binder` is the unscoped legacy entry point; pass a
 * `/clients/:clientId/binder` path to exercise the scoped one.
 */
function renderPage(path = '/binder') {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/binder" element={<EmergencyBinderPage />} />
          <Route path="/clients/:clientId/binder" element={<EmergencyBinderPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

async function selectDemoCase() {
  await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));
  fireEvent.change(screen.getAllByRole('combobox')[0]!, {
    target: { value: 'case-demo-001' },
  });
  await waitFor(() => expect(screen.getByText('2026-07')).toBeInTheDocument());
}

describe('EmergencyBinderPage', () => {
  const printMock = vi.fn();

  beforeEach(() => {
    vi.mocked(listEmploymentCases).mockReset();
    vi.mocked(listEmploymentCases).mockResolvedValue([DEMO_CASE]);
    mocks.createBinderExport.mockReset();
    mocks.createBinderExport.mockResolvedValue({ receipt: DEMO_RECEIPT, replayed: false });
    printMock.mockReset();
    window.print = printMock;
  });

  // --- WEB-11: the binder is no longer a dead end -----------------------
  //
  // Before migration 0042 and the canonical-case link, this screen was in the
  // mobile nav, called listEmploymentCases(), and showed every real user
  // "לא נמצא תיק העסקה פעיל." forever, because nothing in the product created a
  // case. These two tests fail without the link and without the empty-state
  // call to action.

  it('opens on the case linked to this client instead of an empty picker', async () => {
    vi.mocked(listEmploymentCases).mockResolvedValue([
      { ...DEMO_CASE, id: 'case-other-001', legacyClientId: 'client-other' },
      { ...DEMO_CASE, legacyClientId: 'client-a' },
    ]);

    renderPage('/clients/client-a/binder');

    // Selected without the user touching the picker, and it is the linked case
    // - not merely the first one returned.
    await waitFor(() => expect(screen.getByText('2026-07')).toBeInTheDocument());
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('case-demo-001');
    // And the canonical case screen is now linked, not reachable only by
    // pasting a UUID into the address bar.
    expect(screen.getByRole('link', { name: /תיק ההעסקה המלא/ })).toHaveAttribute(
      'href',
      '/cases/case-demo-001',
    );
  });

  it('leaves the picker alone when no case is linked to this client', async () => {
    renderPage('/clients/client-a/binder');
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));
    // DEMO_CASE predates 0042 (legacyClientId null): the user still chooses.
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('');
  });

  it('offers case creation instead of a dead end when the tenant has no case', async () => {
    vi.mocked(listEmploymentCases).mockResolvedValue([]);

    renderPage('/clients/client-a/binder');

    const link = await screen.findByRole('link', { name: /פתיחת תיק העסקה/ });
    expect(link).toHaveAttribute('href', '/clients/client-a/cases/new');
  });

  it('loads and displays employment cases for selection', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /רות כהן/ })).toBeInTheDocument(),
    );
  });

  it('print button is disabled until a case is selected', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));
    expect(screen.getByRole('button', { name: /יצירת PDF/ })).toBeDisabled();
  });

  it('loads case data and shows payroll after selecting a case', async () => {
    renderPage();
    await selectDemoCase();
  });

  it('hides payroll section when the payroll checkbox is unchecked', async () => {
    renderPage();
    await selectDemoCase();
    fireEvent.click(screen.getByRole('checkbox', { name: /היסטוריית תשלומים/ }));
    expect(screen.queryByText('2026-07')).not.toBeInTheDocument();
  });

  it('requires explicit document selection — documents not auto-included', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));
    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'case-demo-001' },
    });
    await waitFor(() => expect(screen.getByText(/לא נבחרו מסמכים/)).toBeInTheDocument());
  });

  it('shows open tasks in binder when tasks section is selected', async () => {
    renderPage();
    await selectDemoCase();
    expect(screen.getByText(/חידוש ביטוח/)).toBeInTheDocument();
  });

  it('records the export server-side and shows the receipt id and hash before printing', async () => {
    renderPage();
    await selectDemoCase();

    fireEvent.click(screen.getByRole('button', { name: /יצירת PDF/ }));

    await waitFor(() => expect(printMock).toHaveBeenCalledOnce());
    expect(mocks.createBinderExport).toHaveBeenCalledOnce();
    expect(mocks.createBinderExport).toHaveBeenCalledWith(
      'case-demo-001',
      {
        sections: ['case', 'caregiver', 'medications', 'documents', 'payroll', 'tasks', 'contacts'],
        documentIds: [],
      },
      expect.any(String),
    );
    // The receipt ("אסמכתת ייצוא") is visible on screen and inside the
    // printable document before window.print ran.
    expect(screen.getAllByText(/אסמכתת ייצוא/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(DEMO_RECEIPT.id)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(DEMO_RECEIPT.contentHash)).length).toBeGreaterThan(0);
  });

  it('sends explicitly selected document ids in the manifest', async () => {
    renderPage();
    await selectDemoCase();

    fireEvent.click(screen.getByRole('checkbox', { name: /דרכון/ }));
    fireEvent.click(screen.getByRole('button', { name: /יצירת PDF/ }));

    await waitFor(() => expect(mocks.createBinderExport).toHaveBeenCalledOnce());
    expect(mocks.createBinderExport.mock.calls[0]?.[1]).toEqual({
      sections: ['case', 'caregiver', 'medications', 'documents', 'payroll', 'tasks', 'contacts'],
      documentIds: ['doc-demo-001'],
    });
  });

  it('still prints when the server is unreachable, labelled as an unrecorded local print', async () => {
    mocks.createBinderExport.mockRejectedValue(new Error('offline'));
    renderPage();
    await selectDemoCase();

    fireEvent.click(screen.getByRole('button', { name: /יצירת PDF/ }));

    await waitFor(() => expect(printMock).toHaveBeenCalledOnce());
    expect(screen.getByRole('alert')).toHaveTextContent(/הדפסה מקומית ללא רישום/);
    expect(screen.queryByText(/אסמכתת ייצוא/)).not.toBeInTheDocument();
  });
});
