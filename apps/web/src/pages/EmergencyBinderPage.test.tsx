import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmergencyBinderPage } from './EmergencyBinderPage.js';

// Canonical API mocks — the new EmergencyBinderPage reads from authenticated
// case APIs, not mvp-storage. Constitution §16: synthetic data only.
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
}));

describe('EmergencyBinderPage', () => {
  it('loads and displays employment cases for selection', async () => {
    render(<EmergencyBinderPage />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /רות כהן/ })).toBeInTheDocument(),
    );
  });

  it('print button is disabled until a case is selected', async () => {
    render(<EmergencyBinderPage />);
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));
    expect(screen.getByRole('button', { name: /יצירת PDF/ })).toBeDisabled();
  });

  it('loads case data and shows payroll after selecting a case', async () => {
    render(<EmergencyBinderPage />);
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));

    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'case-demo-001' },
    });

    await waitFor(() => expect(screen.getByText('2026-07')).toBeInTheDocument());
  });

  it('hides payroll section when the payroll checkbox is unchecked', async () => {
    render(<EmergencyBinderPage />);
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));

    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'case-demo-001' },
    });
    await waitFor(() => screen.getByText('2026-07'));

    fireEvent.click(screen.getByRole('checkbox', { name: /היסטוריית תשלומים/ }));
    expect(screen.queryByText('2026-07')).not.toBeInTheDocument();
  });

  it('requires explicit document selection — documents not auto-included', async () => {
    render(<EmergencyBinderPage />);
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));

    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'case-demo-001' },
    });

    await waitFor(() => expect(screen.getByText(/לא נבחרו מסמכים/)).toBeInTheDocument());
  });

  it('shows open tasks in binder when tasks section is selected', async () => {
    render(<EmergencyBinderPage />);
    await waitFor(() => screen.getByRole('option', { name: /רות כהן/ }));

    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'case-demo-001' },
    });

    await waitFor(() => expect(screen.getByText(/חידוש ביטוח/)).toBeInTheDocument());
  });
});
