import type { Clock } from '@caredesk/application';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Deterministic clock for tests — never rely on wall-clock time in assertions. */
export class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}

  now(): Date {
    return this.fixed;
  }
}
