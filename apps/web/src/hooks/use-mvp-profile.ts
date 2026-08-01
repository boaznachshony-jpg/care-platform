import { useEffect, useState } from 'react';
import {
  MVP_PROFILE_CHANGED,
  readMvpProfile,
  saveMvpProfile,
  type MvpProfile,
} from '../storage/mvp-storage.js';

export function useMvpProfile(): [MvpProfile, (profile: MvpProfile) => void] {
  const [profile, setProfileState] = useState(readMvpProfile);

  useEffect(() => {
    const refresh = () => setProfileState(readMvpProfile());
    window.addEventListener(MVP_PROFILE_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(MVP_PROFILE_CHANGED, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const setProfile = (next: MvpProfile) => {
    saveMvpProfile(next);
    setProfileState(next);
  };

  return [profile, setProfile];
}
