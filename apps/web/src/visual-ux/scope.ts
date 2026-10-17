import { getDeploymentEnvironment } from '../environment.js';

/** Only the approved first-stage screens, including the existing client entry. */
export function isVisualUxRoute(pathname: string): boolean {
  if (pathname.includes('//')) return false;
  const path = pathname.replace(/\/$/, '') || '/';
  return (
    path === '/app' ||
    path === '/tasks' ||
    path === '/medications' ||
    /^\/clients\/[^/]+(?:\/(?:tasks|medications))?$/.test(path)
  );
}

/** A build opt-in and a non-production host are both required. */
export function isVisualUxEnabled({
  mode,
  hostname,
  pathname,
}: {
  mode: string;
  hostname: string;
  pathname: string;
}): boolean {
  return (
    mode === 'ux-v2-test' &&
    getDeploymentEnvironment(hostname) !== 'production' &&
    isVisualUxRoute(pathname)
  );
}
