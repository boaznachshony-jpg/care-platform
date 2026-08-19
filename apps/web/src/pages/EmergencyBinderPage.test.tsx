import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

// Canonical API mocks — the new EmergencyBinderPage reads from authenticated
// case APIs, not mvp-storage. Constitution §16: synthetic data only.
const mocks = vi.hoisted(() => ({
  createBinderExport: vi.fn(),
}));

vi.mock('../api/client.js', () => ({
  listEmploymentCases: vi.fn().mockResolvedValue([
    {
      id: 'case-demo-001',
      careRecipient: { fullName: 'רות כהן (הדגמה)' },
      caregiver: { legalName: 'Ana Reyes', preferredName: 'Ana' },
      employer: { fullName: 'דנה כהן (הדגמה)' },
      startDate: '2025-01-14',
      status: 'active',
    },
  ]),
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

import { EmergencyBinderPage } from './EmergencyBinderPage.js';

const DEMO_RECEIPT = {
  id: 'receipt-demo-001',
  caseId: 'case-demo-001',
  manifest: {
    sections: ['case', 'caregiver', 'documents', 'payroll', 'tasks', 'contacts'],
    documentIds: [],
  },
  contentHash: 'ab'.repeat(32),
  hashAlgorithm: 'sha256' as const,
  createdBy: 'user-demo-001',
  createdAt: '2026-08-19T10:00:00.000Z',
};

function renderPage() {
  return render(
    <I18nextProvider i18n={initI18n()}>
      <EmergencyBinderPage />
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
    mocks.createBinderExport.mockReset();
    mocks.createBinderExport.mockResolvedValue({ receipt: DEMO_RECEIPT, replayed: false });
    printMock.mockReset();
    window.print = printMock;
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
        sections: ['case', 'caregiver', 'documents', 'payroll', 'tasks', 'contacts'],
        documentIds: [],
      },
      expect.any(String),
    );
    // The receipt ("אסמכתת ייצוא") is visible on screen and inside the
    // printable document before window.print ran.
    expect(screen.getAllByText(/binder\.receiptLabel/).length).toBeGreaterThan(0);
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
      sections: ['case', 'caregiver', 'documents', 'payroll', 'tasks', 'contacts'],
      documentIds: ['doc-demo-001'],
    });
  });

  it('still prints when the server is unreachable, labelled as an unrecorded local print', async () => {
    mocks.createBinderExport.mockRejectedValue(new Error('offline'));
    renderPage();
    await selectDemoCase();

    fireEvent.click(screen.getByRole('button', { name: /יצירת PDF/ }));

    await waitFor(() => expect(printMock).toHaveBeenCalledOnce());
    expect(screen.getByRole('alert')).toHaveTextContent(/binder\.unrecordedLocalPrint/);
    expect(screen.queryByText(/binder\.receiptLabel/)).not.toBeInTheDocument();
  });
});
