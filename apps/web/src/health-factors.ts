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
