import { describe, expect, it } from 'vitest';
import { resolveAuthGateState } from './auth-context.js';

describe('authentication gate', () => {
  it('allows an explicit local-only bypass when no provider is configured', () => {
    expect(resolveAuthGateState(false, 'local')).toBe('local-bypass');
  });

  it('fails closed in staging and production without provider configuration', () => {
    expect(resolveAuthGateState(false, 'staging')).toBe('configuration-required');
    expect(resolveAuthGateState(false, 'production')).toBe('configuration-required');
  });

  it('loads the remote session when provider configuration exists', () => {
    expect(resolveAuthGateState(true, 'staging')).toBe('loading');
  });
});
