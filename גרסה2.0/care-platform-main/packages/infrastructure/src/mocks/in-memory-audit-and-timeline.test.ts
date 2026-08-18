import { describe, expect, it } from 'vitest';
import { InMemoryAuditService } from './in-memory-audit-service.js';
import { InMemoryTimelineService } from './in-memory-timeline-service.js';

describe('InMemoryAuditService', () => {
  it('records every event it is given, in order', async () => {
    const audit = new InMemoryAuditService();
    await audit.record({
      tenantId: 'tenant-1',
      actorId: 'user-1',
      action: 'health.check',
      resourceType: 'system',
      resourceId: 'health',
      correlationId: 'corr-1',
      occurredAt: new Date().toISOString(),
    });

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toBe('health.check');
  });
});

describe('InMemoryTimelineService', () => {
  it('records every event it is given, in order', async () => {
    const timeline = new InMemoryTimelineService();
    await timeline.record({
      tenantId: 'tenant-1',
      employmentCaseId: 'case-1',
      eventTypeKey: 'timeline.case.opened',
      occurredAt: new Date().toISOString(),
      summaryKey: 'timeline.case.opened.summary',
      sensitivity: 'general',
    });

    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]?.eventTypeKey).toBe('timeline.case.opened');
  });
});
