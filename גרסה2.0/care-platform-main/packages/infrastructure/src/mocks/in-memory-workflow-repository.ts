import type { WorkflowRepository, WorkflowTemplateRef } from '@caredesk/application';

/** Shell for Milestone 0 — empty by default; real templates arrive in Milestone 2. */
export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly templates = new Map<string, WorkflowTemplateRef>();

  seed(template: WorkflowTemplateRef): void {
    this.templates.set(template.templateId, template);
  }

  async findTemplate(templateId: string): Promise<WorkflowTemplateRef | null> {
    return this.templates.get(templateId) ?? null;
  }
}
