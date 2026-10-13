import { useEffect, useState } from 'react';
import { MVP_PROFILE_CHANGED, readMvpRecipientContact } from '../storage/mvp-storage.js';

/**
 * The care recipient's name and email, re-read when the workspace arrives.
 *
 * WHY THIS IS NOT `useState(readMvpRecipientContact)`
 * ---------------------------------------------------
 * That is what `BillingPage` did, and it was correct only while the MVP store
 * was local-only. Once the workspace became server-canonical and asynchronously
 * hydrated (`0046_mvp_local_data_server_migration`), a lazy initialiser ran
 * once — before hydration landed — and the component never looked again.
 *
 * On a device that had been used before, localStorage was already warm and the
 * one-shot read succeeded, so the screen looked right. On a cold cache — a new
 * browser, another device, a cleared cache, or a customer who had just signed
 * up — the read returned empty, the payer name defaulted to nothing and the
 * "same as the care recipient" option disappeared entirely, because it renders
 * only when there is a contact to copy.
 *
 * `SettingsPage` already survives this, via an effect keyed on the hydrated
 * profile; `useMvpProfile` already carries the subscription. This hook is the
 * same subscription around `readMvpRecipientContact`, which is kept because it
 * has its own fallback (the latest client's profile when the direct one is
 * empty) that `useMvpProfile` does not.
 */
export function useMvpRecipientContact(): { name: string; email: string } {
  const [contact, setContact] = useState(readMvpRecipientContact);

  useEffect(() => {
    const refresh = () =>
      setContact((current) => {
        const next = readMvpRecipientContact();
        // Keep the existing object when nothing changed: this value is an
        // effect dependency in `BillingPage`, and a fresh object on every
        // storage event would re-run that effect for no reason.
        return next.name === current.name && next.email === current.email ? current : next;
      });
    window.addEventListener(MVP_PROFILE_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(MVP_PROFILE_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return contact;
}
