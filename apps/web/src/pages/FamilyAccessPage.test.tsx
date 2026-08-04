import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@caredesk/i18n';

const mocks = vi.hoisted(() => ({
  listFamilyMembers: vi.fn(),
  inviteFamilyMember: vi.fn(),
  updateFamilyMemberRole: vi.fn(),
  revokeFamilyMember: vi.fn(),
}));

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, ...mocks };
});

import { FamilyAccessPage } from './FamilyAccessPage.js';

const owner = {
  membershipId: '00000000-0000-4000-8000-000000000003',
  displayName: 'Account Owner',
  email: 'owner@example.test',
  role: 'owner' as const,
  status: 'active' as const,
  invitedAt: new Date(0).toISOString(),
  lastAuthenticatedAt: new Date().toISOString(),
  isCurrentUser: true,
};

function renderPage() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <FamilyAccessPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('FamilyAccessPage', () => {
  beforeEach(async () => {
    await initI18n().changeLanguage('en');
    mocks.listFamilyMembers.mockReset().mockResolvedValue({ canManage: true, members: [owner] });
    mocks.inviteFamilyMember.mockReset().mockResolvedValue({});
    mocks.updateFamilyMemberRole.mockReset().mockResolvedValue({});
    mocks.revokeFamilyMember.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await initI18n().changeLanguage('he');
  });

  it('shows the current member and sends a manager invitation', async () => {
    renderPage();
    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Family Manager' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'manager@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    await waitFor(() =>
      expect(mocks.inviteFamilyMember).toHaveBeenCalledWith({
        displayName: 'Family Manager',
        email: 'manager@example.test',
        role: 'manager',
      }),
    );
  });

  it('does not expose management actions to a read-only member', async () => {
    mocks.listFamilyMembers.mockResolvedValue({ canManage: false, members: [owner] });
    renderPage();
    expect(await screen.findByText('owner@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invitation' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the owner can invite people/)).toBeInTheDocument();
  });
});
