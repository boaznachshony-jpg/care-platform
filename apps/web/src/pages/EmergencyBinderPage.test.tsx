import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { EmergencyBinderPage } from './EmergencyBinderPage.js';

vi.mock('../hooks/use-mvp-profile.js', () => ({
  useMvpProfile: () => [{ recipientName: 'רות', employerName: 'דנה', caregiverName: 'Maria' }],
}));
vi.mock('../storage/mvp-storage.js', () => ({
  readMvpDocuments: () => [
    {
      id: 'doc-1',
      name: 'ביטוח',
      fileName: 'insurance.pdf',
      category: 'insurance',
      status: 'valid',
    },
  ],
  readMvpPayroll: () => [{ id: 'pay-1', month: '2026-07', total: 6500 }],
  readMvpTasks: () => [{ id: 'task-1', title: 'חידוש', dueDate: '2026-09-01', status: 'open' }],
}));

describe('EmergencyBinderPage', () => {
  it('requires explicit document selection and honors section exclusion', () => {
    render(<EmergencyBinderPage />);
    expect(screen.getByText(/לא נבחרו מסמכים/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /ביטוח/ }));
    expect(screen.getByText(/ביטוח — insurance/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /היסטוריית תשלומים/ }));
    expect(screen.queryByText('2026-07')).not.toBeInTheDocument();
  });
});
