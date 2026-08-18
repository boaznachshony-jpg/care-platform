/**
 * Shell only for Milestone 0 — workflow contracts/state-machine wiring.
 * Full WorkflowTemplate/WorkflowInstance/WorkflowStep shape
 * (database-blueprint.md §4.6) is implemented starting Milestone 2
 * (Visa Renewal).
 */
export interface WorkflowTemplateRef {
  templateId: string;
  version: string;
  status: string;
}

export interface WorkflowRepository {
  findTemplate(templateId: string): Promise<WorkflowTemplateRef | null>;
}
