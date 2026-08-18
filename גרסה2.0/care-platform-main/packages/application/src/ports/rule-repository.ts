/**
 * Shell only for Milestone 0 — deterministic types/evaluator wiring, no
 * legal values. Full RuleDefinition/RuleVersion/RuleSource shape
 * (database-blueprint.md §4.9) is implemented in Milestone 2.
 */
export interface RuleVersionRef {
  ruleDefinitionId: string;
  ruleVersionId: string;
  status: string;
}

export interface RuleRepository {
  findActiveVersions(ruleDefinitionId: string): Promise<RuleVersionRef[]>;
}
