export const UX_PREVIEW_BRANCH = 'feature/caredesk-ux-v2';
const PREVIEW_HOST = /^care-platform-web-[a-z0-9-]+-boaznachshony-4103s-projects\.vercel\.app$/;

export function isExternalUxPreview(source: Record<string, string | undefined>): boolean {
  return source.VERCEL_ENV === 'preview' && source.VERCEL_GIT_COMMIT_REF === UX_PREVIEW_BRANCH;
}

export function externalPreviewOrigins(source: Record<string, string | undefined>): string[] {
  if (!isExternalUxPreview(source))
    throw new Error('External UX build requires its preview branch.');
  const hosts = [source.VERCEL_URL, source.VERCEL_BRANCH_URL];
  if (!hosts[0] || hosts.some((host) => host !== undefined && !PREVIEW_HOST.test(host))) {
    throw new Error('External UX build requires dedicated Vercel preview hosts.');
  }
  return [...new Set(hosts.filter((host): host is string => Boolean(host)))].map(
    (host) => `https://${host}`,
  );
}
