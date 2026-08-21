export type DeploymentEnvironment = 'production' | 'staging' | 'local';

export function getDeploymentEnvironment(
  hostname = window.location.hostname,
): DeploymentEnvironment {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return 'local';
  if (hostname === 'caredesk-isr.com' || hostname === 'www.caredesk-isr.com') return 'production';
  if (hostname === 'care-platform-web.vercel.app') return 'production';
  if (hostname.endsWith('.vercel.app')) return 'staging';
  return 'production';
}

export function getEnvironmentTranslationKey(
  environment = getDeploymentEnvironment(),
): 'environment.staging' | 'environment.local' | null {
  if (environment === 'staging') return 'environment.staging';
  if (environment === 'local') return 'environment.local';
  return null;
}
