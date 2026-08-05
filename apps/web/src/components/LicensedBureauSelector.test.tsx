import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '@caredesk/i18n';
import { emptyMvpProfile, type MvpProfile } from '../storage/mvp-storage.js';
import { LicensedBureauSelector } from './LicensedBureauSelector.js';

function SelectorHarness() {
  const [profile, setProfile] = useState<MvpProfile>(emptyMvpProfile);
  return <LicensedBureauSelector profile={profile} onChange={setProfile} required />;
}

describe('LicensedBureauSelector', () => {
  it('fills the published bureau and contact details from the official selection', () => {
    render(
      <I18nextProvider i18n={initI18n()}>
        <SelectorHarness />
      </I18nextProvider>,
    );

    const selector = screen.getByLabelText('בחירת תאגיד או לשכה פרטית מורשית');
    expect(screen.getAllByRole('option')).toHaveLength(92);
    expect(screen.queryByText(/אופק רגב/)).not.toBeInTheDocument();

    fireEvent.change(selector, { target: { value: '513986042' } });

    expect(screen.getByText('א. גונן שירותי סיעוד')).toBeInTheDocument();
    expect(screen.getByText("ז'בוטנסקי 129, רמת גן", { exact: false })).toBeInTheDocument();
    expect(screen.getByLabelText('שם איש הקשר בתאגיד')).toHaveValue('יקי גרנט');
    expect(screen.getByLabelText('טלפון איש הקשר בתאגיד')).toHaveValue('050-5219099');
    expect(screen.getByLabelText('דוא״ל איש הקשר בתאגיד')).toHaveValue('gonen09@gmail.com');
    expect(screen.getByRole('link', { name: 'פתיחת המקור הרשמי' })).toHaveAttribute(
      'href',
      expect.stringContaining('gov.il'),
    );
  });

  it('keeps manual entry available for a bureau missing from the official list', () => {
    render(
      <I18nextProvider i18n={initI18n()}>
        <SelectorHarness />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByLabelText('בחירת תאגיד או לשכה פרטית מורשית'), {
      target: { value: '__manual__' },
    });

    expect(screen.getByLabelText('שם התאגיד המורשה')).toBeInTheDocument();
    expect(screen.getByLabelText('מספר הרישום או הרישיון של התאגיד')).toBeInTheDocument();
  });
});
