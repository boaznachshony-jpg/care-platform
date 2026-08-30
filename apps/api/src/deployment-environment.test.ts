import { describe, expect, it } from 'vitest';
import { getDeploymentEnvironment } from './deployment-environment.js';

describe('getDeploymentEnvironment', () => {
  it('treats an empty environment as local', () => {
    expect(getDeploymentEnvironment({})).toBe('local');
  });

  it('recognises production only from an explicit VERCEL_ENV=production', () => {
    expect(getDeploymentEnvironment({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('production');
  });

  it('classifies preview and vercel dev as staging', () => {
    expect(getDeploymentEnvironment({ VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('staging');
    expect(getDeploymentEnvironment({ VERCEL: '1', VERCEL_ENV: 'development' })).toBe('staging');
  });

  it('classifies an unknown or missing VERCEL_ENV on Vercel as staging, not production', () => {
    // An environment name this code has never seen must not unlock production
    // data; the guard that reads this must fail closed on the unknown case.
    expect(getDeploymentEnvironment({ VERCEL: '1', VERCEL_ENV: 'some-future-name' })).toBe(
      'staging',
    );
    expect(getDeploymentEnvironment({ VERCEL: '1' })).toBe('staging');
    expect(getDeploymentEnvironment({ VERCEL: '1', VERCEL_ENV: '' })).toBe('staging');
  });
});
