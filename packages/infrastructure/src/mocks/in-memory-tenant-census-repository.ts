import type { TenantCensus, TenantCensusRepository } from '@caredesk/application';

/**
 * Census store for environments with no database.
 *
 * `collect()` returns what the test seeded as "today"; `record()` appends, and
 * `findPrevious()` returns the newest recorded row - so a two-run test really
 * does compare the second observation against the first, which is the ordering
 * bug most likely to make a real detector blind.
 */
export class InMemoryTenantCensusRepository implements TenantCensusRepository {
  private observations: TenantCensus[] = [];
  private readonly recorded: TenantCensus[] = [];

  seedObservations(observations: TenantCensus[]): void {
    this.observations = observations;
  }

  seedPrevious(census: TenantCensus): void {
    this.recorded.push(census);
  }

  get history(): readonly TenantCensus[] {
    return this.recorded;
  }

  async collect(): Promise<TenantCensus[]> {
    return this.observations.map((observation) => ({ ...observation }));
  }

  async findPrevious(tenantId: string): Promise<TenantCensus | null> {
    const rows = this.recorded.filter((row) => row.tenantId === tenantId);
    return rows.length > 0 ? (rows[rows.length - 1] ?? null) : null;
  }

  async record(census: TenantCensus): Promise<void> {
    this.recorded.push({ ...census });
  }
}
