import type { TimelineEventInput, TimelineService } from '@caredesk/application';

export class InMemoryTimelineService implements TimelineService {
  readonly events: TimelineEventInput[] = [];

  async record(event: TimelineEventInput): Promise<void> {
    this.events.push(event);
  }
}
