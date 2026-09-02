/**
 * Only the shape actually used here, so this module does not depend on the
 * i18next types package being present in the web app.
 */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The case-health API returns factor titles and explanations in English
 * ("Medical insurance", "No currently valid document was found"). In a
 * Hebrew-first product that means a customer scanning the panel for what needs
 * attention does not recognise the item at all - which is why a missing
 * medical insurance document read as "no alert" rather than as an alert.
 *
 * The server stays the source of truth for WHICH factors exist and their
 * status; the locale decides the wording, exactly as the timeline already
 * does. Unknown ids fall back to the server text so a new factor is never
 * invisible.
 */
export interface HealthFactorLike {
  id: string;
  title: string;
  status: 'good' | 'attention' | 'not_applicable';
  explanation: string;
  recommendedAction?: string;
  provenance?: { sourceIds?: string[] };
}

export function healthFactorTitle(factor: HealthFactorLike, t: Translate): string {
  const key = `health.factor.${factor.id}`;
  const translated = t(key);
  return translated === key ? factor.title : translated;
}

export function healthFactorExplanation(factor: HealthFactorLike, t: Translate): string {
  if (factor.id === 'governed_tasks') {
    const openCount = factor.provenance?.sourceIds?.length ?? 0;
    return factor.status === 'good'
      ? t('health.tasksNone')
      : t('health.tasksOpen', { count: openCount });
  }
  const key = factor.status === 'good' ? 'health.documentValid' : 'health.documentMissing';
  const translated = t(key);
  return translated === key ? factor.explanation : translated;
}

/**
 * The action link's wording.
 *
 * The titles and explanations were localised when this module was written; the
 * `recommendedAction` was not, so three English links — "Upload or review the
 * document" — sat inside otherwise-Hebrew sentences on the case panel, the
 * dashboard and the open-issues page. It is the only clickable text in that
 * list, which makes it the worst one to leave untranslated: it is what the
 * reader is being asked to do.
 *
 * Same contract as the two above: the server decides whether there is an
 * action, the locale decides how it reads, and an unrecognised factor falls
 * back to the server's text rather than losing its link.
 */
export function healthFactorAction(factor: HealthFactorLike, t: Translate): string | undefined {
  if (!factor.recommendedAction) return undefined;
  const key = factor.id === 'governed_tasks' ? 'health.actionTasks' : 'health.actionDocument';
  const translated = t(key);
  return translated === key ? factor.recommendedAction : translated;
}
