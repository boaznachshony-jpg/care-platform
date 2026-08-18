import type { RuleRepository, RuleVersionRef } from '@caredesk/application';

/** Shell for Milestone 0 — empty by default; real rule content arrives in Milestone 2. */
export class InMemoryRuleRepository implements RuleRepository {
  private readonly versions: RuleVersionRef[] = [];

  seed(version: RuleVersionRef): void {
    this.versions.push(version);
  }

  async findActiveVersions(ruleDefinitionId: string): Promise<RuleVersionRef[]> {
    return this.versions.filter(
      (version) => version.ruleDefinitionId === ruleDefinitionId && version.status === 'active',
    );
  }
}
