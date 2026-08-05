import { describe, expect, it } from 'vitest';
import { validateRegistration } from './LoginPage.js';

describe('registration validation', () => {
  it('accepts an email username with matching secure passwords', () => {
    expect(
      validateRegistration('owner@example.test', 'a-secure-password', 'a-secure-password'),
    ).toBeNull();
  });

  it('rejects an invalid email address', () => {
    expect(validateRegistration('owner', 'a-secure-password', 'a-secure-password')).toBe('email');
  });

  it('requires at least 12 characters', () => {
    expect(validateRegistration('owner@example.test', 'short', 'short')).toBe('password');
  });

  it('requires the password confirmation to match', () => {
    expect(
      validateRegistration('owner@example.test', 'a-secure-password', 'another-password'),
    ).toBe('confirmation');
  });
});
