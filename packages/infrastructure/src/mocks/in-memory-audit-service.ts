import type { AuditEventInput, AuditService } from '@caredesk/application';

export class InMemoryAuditService implements AuditService {
  readonly events: AuditEventInput[] = [];

  async record(event: AuditEventInput): Promise<void> {
    this.events.push(event);
  }
}
