import { describe, expect, it } from 'vitest';
import { isVisualUxEnabled, isVisualUxRoute } from './scope.js';

const approvedRoutes = [
  '/app',
  '/app/',
  '/clients/family-1',
  '/clients/family-1/',
  '/tasks',
  '/tasks/',
  '/medications',
  '/medications/',
  '/clients/family-1/tasks',
  '/clients/family-1/tasks/',
  '/clients/family-1/medications',
  '/clients/family-1/medications/',
];

describe('approved visual route boundary', () => {
  it.each(approvedRoutes)('allows the existing target %s', (pathname) => {
    expect(isVisualUxRoute(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/login',
    '/onboarding',
    '/settings',
    '/payroll',
    '/worker',
    '/clients',
    '/clients/',
    '/clients/family-1/settings',
    '/clients/family-1/payroll',
    '/clients/family-1/onboarding',
    '/clients/family-1/worker',
    '/clients/family-1/tasks/history',
    '/clients/family-1/medications/edit',
    '/tasks-extra',
    '/app/extra',
    '/tasks//',
    '/clients/family-1/tasks//',
  ])('does not extend visual styling to %s', (pathname) => {
    expect(isVisualUxRoute(pathname)).toBe(false);
  });
});

describe('explicit TEST activation', () => {
  it.each(['localhost', '127.0.0.1', '::1', 'care-platform-web-git-test-example.vercel.app'])(
    'allows the TEST build on existing non-production host %s',
    (hostname) => {
      expect(isVisualUxEnabled({ mode: 'ux-v2-test', hostname, pathname: '/tasks' })).toBe(true);
    },
  );

  it.each(['', 'test', 'development', 'production', 'ux-v2', 'UX-V2-TEST'])(
    'stays off for build mode %s even on loopback',
    (mode) => {
      expect(isVisualUxEnabled({ mode, hostname: '127.0.0.1', pathname: '/app' })).toBe(false);
    },
  );

  it.each([
    'caredesk-isr.com',
    'www.caredesk-isr.com',
    'care-platform-web.vercel.app',
    'example.com',
    'staging.example.com',
    'localhost.example.com',
    'vercel.app.example.com',
  ])('fails closed on production or unknown host %s', (hostname) => {
    expect(isVisualUxEnabled({ mode: 'ux-v2-test', hostname, pathname: '/tasks' })).toBe(false);
  });

  it('keeps excluded routes unchanged even when mode and host are eligible', () => {
    expect(
      isVisualUxEnabled({ mode: 'ux-v2-test', hostname: 'localhost', pathname: '/payroll' }),
    ).toBe(false);
  });
});
