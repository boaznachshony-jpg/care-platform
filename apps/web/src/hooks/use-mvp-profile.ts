import { useEffect, useState } from 'react';
import {
  MVP_PROFILE_CHANGED,
  isMvpProfileStorageKey,
  readMvpProfile,
  saveMvpProfile,
  type MvpProfile,
} from '../storage/mvp-storage.js';
import {
  StorageWriteError,
  profileFollowUpFailureMessage,
  storageWriteFailureMessage,
} from '../storage/storage-write-error.js';

/**
 * The profile, a setter, and the reason the last write was refused ('' once a
 * write lands).
 *
 * Silent saves (17.10.2026): the setter used to call `saveMvpProfile` and then
 * put the new profile into state unconditionally. Since #143 a refused write
 * throws `StorageWriteError`, and here it escaped the settings, caregiver,
 * onboarding and salary screens' handlers, so the screen said nothing (and,
 * on onboarding, moved on as if the step had been kept). The setter now
 * returns false on a refusal and leaves the profile on screen as stored; the
 * screen shows `saveError` and stops before saying anything was saved.
 */
export function useMvpProfile(): [MvpProfile, (profile: MvpProfile) => boolean, string] {
  const [profile, setProfileState] = useState(readMvpProfile);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const refresh = () => setProfileState(readMvpProfile());
    window.addEventListener(MVP_PROFILE_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(MVP_PROFILE_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const setProfile = (next: MvpProfile): boolean => {
    try {
      saveMvpProfile(next);
    } catch (error) {
      // Whatever happened, the screen shows what is stored.
      setProfileState(readMvpProfile());
      if (error instanceof StorageWriteError && !isMvpProfileStorageKey(error.key)) {
        // The profile itself landed; only a write that follows it (the
        // employer list's label, the automatic renewal tasks) was refused.
        // Saying "not saved" here would be its own kind of untrue.
        setSaveError(profileFollowUpFailureMessage(error));
        return true;
      }
      setSaveError(storageWriteFailureMessage(error));
      return false;
    }
    setSaveError('');
    setProfileState(next);
    return true;
  };

  return [profile, setProfile, saveError];
}
