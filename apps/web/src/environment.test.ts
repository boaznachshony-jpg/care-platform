import { describe, expect, it } from 'vitest';
import { getDeploymentEnvironment, getEnvironmentTranslationKey } from './environment.js';

describe('deployment environment', () => {
  it('identifies the stable production hostname', () => {
    expect(getDeploymentEnvironment('care-platform-web.vercel.app')).toBe('production');
    expect(getEnvironmentTranslationKey('production')).toBeNull();
  });

  it('marks Vercel preview deployments as staging', () => {
    expect(getDeploymentEnvironment('care-platform-web-git-staging-example.vercel.app')).toBe(
      'staging',
    );
    expect(getEnvironmentTranslationKey('staging')).toBe('environment.staging');
  });

  it('keeps local development explicit', () => {
    expect(getDeploymentEnvironment('localhost')).toBe('local');
  });
});
