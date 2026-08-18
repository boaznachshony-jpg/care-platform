import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '@caredesk/application';

export class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/** Deterministic, sequential IDs for tests — never a random UUID in an assertion. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return `test-id-${this.counter}`;
  }
}
