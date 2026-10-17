import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isVisualUxEnabled } from './scope.js';
import './approved.css';

/** Opt-in presentation only: no fixture, data, auth or application handlers. */
export function UxV2VisualLayer() {
  const { pathname } = useLocation();
  const enabled = isVisualUxEnabled({
    mode: import.meta.env.MODE,
    hostname: window.location.hostname,
    pathname,
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('ux-v2-visual', enabled);
    return () => root.classList.remove('ux-v2-visual');
  }, [enabled]);

  return null;
}
