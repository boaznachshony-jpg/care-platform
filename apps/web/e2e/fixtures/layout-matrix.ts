/**
 * Release gate §2 — "מטריצת רוחבים ויזואלית".
 *
 * Two halves that are deliberately kept apart:
 *
 *   1. `collectLayoutSnapshot` runs INSIDE the browser (`page.evaluate`). It only
 *      measures. It never asserts, never decides, and never throws. Because it is
 *      serialized by Playwright it must stay self-contained: no imports, no closure
 *      variables, no TypeScript constructs that need runtime helpers.
 *   2. `findLayoutViolations` runs in Node. It is a pure function from a snapshot to
 *      a list of human-readable violations, every one of which carries the measured
 *      number. That is what gate §4 demands: "לא 'נראה חתוך' אלא 'חופף ב-208px'".
 *
 * Keeping the rules pure is also what makes them testable without a browser.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverflowOffender {
  selector: string;
  /** How far past the viewport edge the element's border box reaches, in CSS px. */
  overflowPx: number;
  side: 'start' | 'end';
  width: number;
}

export interface SidebarOverlap {
  selector: string;
  text: string;
  overlapWidth: number;
  overlapHeight: number;
  /** How many probe points inside the overlap were sampled with elementFromPoint. */
  samples: number;
  /** How many of those points resolved to the sidebar, i.e. the element is hidden there. */
  occludedSamples: number;
}

export interface ButtonMeasurement {
  selector: string;
  text: string;
  width: number;
  height: number;
  /** `scrollWidth`/`clientWidth` are the gate's literal wording. 0 for inline boxes. */
  scrollWidth: number;
  clientWidth: number;
  /** Border box minus padding and borders — the space the label actually gets. */
  contentWidth: number;
  /** Widest horizontal extent of the button's own content, measured with a Range. */
  textWidth: number;
  /**
   * A labelled action button (has text, wider than tall). Icon-only square buttons
   * are intentionally excluded from the "same row, same size" rule: a 44×44 icon
   * sitting next to a text button is a layout decision, not a defect.
   */
  isTextButton: boolean;
}

export interface ActionRow {
  container: string;
  /** Rounded viewport-relative top of the row, so failures are locatable. */
  top: number;
  /**
   * True when the container promises identical widths — a flex row whose children
   * all share `flex-grow > 0` with a fixed basis. `.clients-hero-actions` is the
   * canonical case: `flex: 1 1 170px` is the contract that four stacked buttons broke.
   */
  equalWidthContract: boolean;
  buttons: ButtonMeasurement[];
}

export interface TouchTargetMeasurement {
  selector: string;
  text: string;
  width: number;
  height: number;
  /**
   * R4-04. True for the controls `global.css` itself promises 48×48 below
   * 761px (`@media (max-width: 760px)` → `button, [role='button'], summary,
   * .auth-secondary-button, .text-link, .clients-landing a,
   * .onboarding-page a`). Those get the stricter mobile threshold, because the
   * repo already standardised on it; everything else keeps the WCAG 44px floor
   * rather than being held to a promise nobody made about it.
   */
  mobileStandard: boolean;
}

/**
 * R4-04 — text the browser cut off rather than wrapped.
 *
 * A box whose own text is wider than its content box while its `overflow-x`
 * is `hidden` or `clip`: the tail of the sentence is painted nowhere and no
 * scrollbar offers it. Buttons are excluded because rule 3 already owns them.
 */
export interface ClippedText {
  selector: string;
  text: string;
  clippedPx: number;
  clientWidth: number;
  scrollWidth: number;
}

/**
 * R4-04 — text a foreign element paints over.
 *
 * The sidebar rule is the special case of this that production actually hit;
 * this is the general one, for the payroll wizard where a provenance badge
 * (PR #114) added a line beside every amount and pushed neighbours into each
 * other. Fixed and sticky occluders are excluded here on purpose: they can be
 * scrolled out of the way, and the one fixed occluder that matters — the
 * sidebar — has its own rule with its own message.
 */
export interface OccludedText {
  selector: string;
  text: string;
  samples: number;
  occludedSamples: number;
  occluder: string;
}

/**
 * R4-04 — a field and the words that say what to type into it.
 *
 * `accessibleName` is what a screen reader would announce. `labelOverflowPx`
 * is what a sighted user loses: the caption is rendered, but part of its box
 * is past a viewport edge. In an RTL product that edge is usually the right
 * one, which is why the side is recorded rather than assumed.
 */
export interface FormControlMeasurement {
  selector: string;
  accessibleName: string;
  /** True when the name comes from a rendered `<label>`, not only from ARIA. */
  hasLabelElement: boolean;
  labelSelector: string;
  labelText: string;
  /** How far the label's border box reaches past a viewport edge. 0 when inside. */
  labelOverflowPx: number;
  labelSide: 'start' | 'end' | 'none';
}

export interface LayoutSnapshot {
  url: string;
  viewportWidth: number;
  innerWidth: number;
  documentScrollWidth: number;
  sidebar: Box | null;
  overflowOffenders: OverflowOffender[];
  sidebarOverlaps: SidebarOverlap[];
  buttons: ButtonMeasurement[];
  actionRows: ActionRow[];
  touchTargets: TouchTargetMeasurement[];
  clippedTexts: ClippedText[];
  occludedTexts: OccludedText[];
  formControls: FormControlMeasurement[];
}

/** The seven widths named by the release gate. */
export const MATRIX_WIDTHS = [360, 390, 430, 768, 1024, 1440, 2560] as const;

export const MIN_TOUCH_TARGET_PX = 44;

/**
 * R4-04. The repo's own mobile floor, taken from `global.css`
 * `@media (max-width: 760px)`. Applied only below that breakpoint and only to
 * the controls that rule names, so the assertion states the product's existing
 * standard rather than inventing a stricter one.
 */
export const MOBILE_TOUCH_TARGET_PX = 48;
export const MOBILE_TOUCH_TARGET_MAX_WIDTH_PX = 760;

/**
 * `scrollWidth`/`clientWidth` are integers and layout is fractional, so a 1px gap is
 * rounding, not a bug. Anything above it is a real spill.
 */
export const SUBPIXEL_TOLERANCE_PX = 1;

/**
 * Measures one page at the current viewport. Runs in the browser.
 */
export function collectLayoutSnapshot(): LayoutSnapshot {
  const TOUCH_TARGET_SELECTOR =
    'button, [role="button"], a[class*="button"], input[type="checkbox"], input[type="radio"], input[type="submit"], summary, nav a';
  const ACTION_CONTROL_SELECTOR =
    'button, [role="button"], a[class*="button"], input[type="submit"], input[type="button"]';
  const MAX_REPORTED = 40;
  const ROW_TOLERANCE_PX = 4;
  // R4-04. Mirrors the `@media (max-width: 760px)` block in global.css that
  // promises 48x48. Kept as one string so the assertion and the stylesheet can
  // be compared by eye.
  const MOBILE_STANDARD_SELECTOR =
    "button, [role='button'], summary, .auth-secondary-button, .text-link, .clients-landing a, .onboarding-page a";
  const FORM_CONTROL_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea';
  // R4-04. elementFromPoint is nine calls per candidate; the payroll wizard at
  // step 5 renders several hundred text nodes. This bounds the probe so the
  // gate stays a gate and not a load test.
  const MAX_TEXT_PROBES = 300;
  // Reading a label costs no layout probe, and the payroll wizard plus the
  // national-insurance card render well past 40 fields. Truncating there would
  // have made the label rule quietly stop looking on exactly the screen it was
  // written for.
  const MAX_FORM_CONTROLS_REPORTED = 200;
  // Declared here and not taken from module scope on purpose. Playwright
  // serialises this function to a string and evals it inside the page, so any
  // identifier it closes over in Node is simply absent at run time - the first
  // CI run failed on exactly that, at all seven widths, with
  // "SUBPIXEL_TOLERANCE_PX is not defined". The module-level export below is
  // kept for findLayoutViolations, which really does run in Node.
  const SUBPIXEL_TOLERANCE_PX = 1;

  const round = (value: number): number => Math.round(value * 100) / 100;

  const describe = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    for (let depth = 0; node && depth < 3; depth += 1) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += '#' + node.id;
      const raw = typeof node.className === 'string' ? node.className : '';
      const classes = raw.trim().split(/\s+/).filter(Boolean).slice(0, 2);
      for (const cls of classes) part += '.' + cls;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const labelOf = (element: Element): string =>
    (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  /** Text this element renders itself, not text inherited from its descendants. */
  const ownText = (element: Element): string => {
    let text = '';
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) text += node.nodeValue || '';
    }
    return text.replace(/\s+/g, ' ').trim();
  };

  const isVisible = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  };

  const isDisabled = (element: Element): boolean =>
    element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';

  /**
   * Off-canvas by design (the skip link parks itself at -9999px until focused).
   * Such elements do not create page overflow and must not be reported as offenders.
   */
  const isParkedOffCanvas = (element: Element, rect: DOMRect): boolean => {
    const position = window.getComputedStyle(element).position;
    if (position !== 'absolute' && position !== 'fixed') return false;
    return rect.right <= 0 || rect.left >= window.innerWidth;
  };

  const measureContentExtent = (element: Element): number => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = Array.from(range.getClientRects());
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const rect of rects) {
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.left < min) min = rect.left;
      if (rect.right > max) max = rect.right;
    }
    return max > min ? max - min : 0;
  };

  const measureButton = (element: Element): ButtonMeasurement => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const horizontalInset =
      (parseFloat(style.paddingLeft) || 0) +
      (parseFloat(style.paddingRight) || 0) +
      (parseFloat(style.borderLeftWidth) || 0) +
      (parseFloat(style.borderRightWidth) || 0);
    const text = labelOf(element);
    return {
      selector: describe(element),
      text,
      width: round(rect.width),
      height: round(rect.height),
      scrollWidth: (element as HTMLElement).scrollWidth || 0,
      clientWidth: (element as HTMLElement).clientWidth || 0,
      contentWidth: round(Math.max(0, rect.width - horizontalInset)),
      textWidth: round(measureContentExtent(element)),
      isTextButton: text.length > 0 && rect.width > rect.height,
    };
  };

  /**
   * R4-04 — the page shell is not a legitimate clipper.
   *
   * `global.css` sets `overflow-x: clip` on html/body/#root below 761px. That
   * is what stops a spill from producing a scrollbar; it is not what stops the
   * spill. Treating those three as clippers would exempt every mobile overflow
   * from the rule below, which is precisely the hole this item exists to close.
   * Any OTHER ancestor that clips horizontally really does contain its child,
   * so a child that reaches past the viewport from inside it is not visible
   * page overflow and is not reported.
   */
  const isPageShell = (element: Element): boolean =>
    element === document.documentElement || element === document.body || element.id === 'root';

  /**
   * Is this node painted by a fixed or sticky overlay?
   *
   * Asked of the element `elementFromPoint` returned, which is the DEEPEST node
   * at the point — for the mobile bottom nav that is the `<span>` holding the
   * icon, not the `<nav>` that is positioned. Testing only that node's own
   * `position` finds `static` and concludes the nav is ordinary page content,
   * which is how a fixed bar that this rule explicitly does not police was
   * reported as occluding the payroll legend and the document-expiry hint on
   * three widths. The sidebar test on the same line already walks ancestors
   * (`hit.closest('.sidebar')`); this one has to as well, or the two disagree
   * about what "overlay" means.
   */
  const isScrollableAwayOverlay = (node: Element): boolean => {
    for (let current: Element | null = node; current; current = current.parentElement) {
      if (isPageShell(current)) break;
      const position = window.getComputedStyle(current).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };

  const isClippedByAncestor = (element: Element, rect: DOMRect): boolean => {
    let ancestor = element.parentElement;
    while (ancestor && !isPageShell(ancestor)) {
      const overflowX = window.getComputedStyle(ancestor).overflowX;
      if (overflowX !== 'visible') {
        const bounds = ancestor.getBoundingClientRect();
        if (
          rect.right > bounds.right + SUBPIXEL_TOLERANCE_PX ||
          rect.left < bounds.left - SUBPIXEL_TOLERANCE_PX
        ) {
          return true;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  };

  // ---------------------------------------------------------------- overflow
  const overflowOffenders: OverflowOffender[] = [];
  const viewportWidth = window.innerWidth;
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (overflowOffenders.length >= MAX_REPORTED) break;
    if (element.tagName === 'HTML' || element.tagName === 'BODY') continue;
    if (!isVisible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (isParkedOffCanvas(element, rect)) continue;
    if (isClippedByAncestor(element, rect)) continue;
    if (rect.right > viewportWidth + SUBPIXEL_TOLERANCE_PX) {
      overflowOffenders.push({
        selector: describe(element),
        overflowPx: round(rect.right - viewportWidth),
        side: 'end',
        width: round(rect.width),
      });
    } else if (rect.left < -SUBPIXEL_TOLERANCE_PX) {
      overflowOffenders.push({
        selector: describe(element),
        overflowPx: round(-rect.left),
        side: 'start',
        width: round(rect.width),
      });
    }
  }

  // ----------------------------------------------------------- sidebar overlap
  const sidebarElement = document.querySelector('.sidebar');
  const sidebarVisible = sidebarElement !== null && isVisible(sidebarElement);
  const sidebarRect = sidebarVisible ? sidebarElement.getBoundingClientRect() : null;
  const sidebarOverlaps: SidebarOverlap[] = [];

  if (sidebarElement && sidebarRect) {
    // Ancestors of the sidebar wrap it by definition; overlapping it is not a defect.
    const exempt = new Set<Element>();
    let ancestor: Element | null = sidebarElement;
    while (ancestor) {
      exempt.add(ancestor);
      ancestor = ancestor.parentElement;
    }
    const reported: Element[] = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (sidebarOverlaps.length >= MAX_REPORTED) break;
      if (exempt.has(element)) continue;
      if (sidebarElement.contains(element)) continue;
      if (!isVisible(element)) continue;
      // Report the outermost offender only, not every descendant of it.
      if (reported.some((seen) => seen.contains(element))) continue;

      const rect = element.getBoundingClientRect();
      const overlapWidth =
        Math.min(rect.right, sidebarRect.right) - Math.max(rect.left, sidebarRect.left);
      const overlapHeight =
        Math.min(rect.bottom, sidebarRect.bottom) - Math.max(rect.top, sidebarRect.top);
      if (overlapWidth <= SUBPIXEL_TOLERANCE_PX || overlapHeight <= SUBPIXEL_TOLERANCE_PX) continue;

      // Geometric overlap alone is not a defect: the environment banner deliberately
      // spans the full width and paints ON TOP of the sidebar. What breaks a customer
      // is content that lands UNDER the fixed sidebar and disappears. So probe the
      // overlap and ask the browser who actually wins each pixel.
      const left = Math.max(rect.left, sidebarRect.left);
      const top = Math.max(rect.top, sidebarRect.top);
      let samples = 0;
      let occludedSamples = 0;
      for (let column = 1; column <= 3; column += 1) {
        for (let row = 1; row <= 3; row += 1) {
          const x = left + (overlapWidth * column) / 4;
          const y = top + (overlapHeight * row) / 4;
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
          samples += 1;
          const hit = document.elementFromPoint(x, y);
          if (hit && (hit === sidebarElement || sidebarElement.contains(hit))) occludedSamples += 1;
        }
      }
      if (samples === 0 || occludedSamples === 0) continue;
      reported.push(element);
      sidebarOverlaps.push({
        selector: describe(element),
        text: labelOf(element),
        overlapWidth: round(overlapWidth),
        overlapHeight: round(overlapHeight),
        samples,
        occludedSamples,
      });
    }
  }

  // ------------------------------------------------------- buttons and rows
  const buttons: ButtonMeasurement[] = [];
  const actionControls: Element[] = [];
  for (const element of Array.from(document.querySelectorAll(ACTION_CONTROL_SELECTOR))) {
    if (!isVisible(element)) continue;
    actionControls.push(element);
    buttons.push(measureButton(element));
  }

  const actionRows: ActionRow[] = [];
  const containers: Element[] = [];
  for (const control of actionControls) {
    const parent = control.parentElement;
    if (parent && !containers.includes(parent)) containers.push(parent);
  }

  for (const container of containers) {
    const children = actionControls.filter((control) => control.parentElement === container);
    if (children.length < 2) continue;

    const containerStyle = window.getComputedStyle(container);
    const equalWidthContract =
      containerStyle.display.indexOf('flex') !== -1 &&
      children.every((child) => {
        const style = window.getComputedStyle(child);
        return Number(style.flexGrow) > 0 && style.flexBasis !== 'auto';
      });

    const sorted = children
      .map((child) => ({ child, top: child.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top);

    let current: { child: Element; top: number }[] = [];
    const flush = () => {
      if (current.length < 2) return;
      actionRows.push({
        container: describe(container),
        top: Math.round(current[0]!.top),
        equalWidthContract,
        buttons: current.map((entry) => measureButton(entry.child)),
      });
    };
    for (const entry of sorted) {
      if (current.length === 0 || Math.abs(entry.top - current[0]!.top) <= ROW_TOLERANCE_PX) {
        current.push(entry);
      } else {
        flush();
        current = [entry];
      }
    }
    flush();
  }

  // ---------------------------------------------------------- touch targets
  const touchTargets: TouchTargetMeasurement[] = [];
  for (const element of Array.from(document.querySelectorAll(TOUCH_TARGET_SELECTOR))) {
    if (!isVisible(element) || isDisabled(element)) continue;
    if (element.closest('[aria-hidden="true"]')) continue;
    const rect = element.getBoundingClientRect();
    touchTargets.push({
      selector: describe(element),
      text: labelOf(element),
      width: round(rect.width),
      height: round(rect.height),
      mobileStandard: element.matches(MOBILE_STANDARD_SELECTOR),
    });
  }

  // ------------------------------------------------------------ clipped text
  const clippedTexts: ClippedText[] = [];
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (clippedTexts.length >= MAX_REPORTED) break;
    if (isPageShell(element)) continue;
    // Rule 3 already owns buttons, and reporting them twice would make one
    // defect look like two.
    if (element.matches(ACTION_CONTROL_SELECTOR)) continue;
    const text = ownText(element);
    if (!text) continue;
    if (!isVisible(element)) continue;
    const overflowX = window.getComputedStyle(element).overflowX;
    if (overflowX !== 'hidden' && overflowX !== 'clip') continue;
    const box = element as HTMLElement;
    // `sr-only` is a 1px clip box by design: it is hidden text, not lost text.
    if (box.clientWidth <= 1 || box.clientHeight <= 1) continue;
    if (box.scrollWidth <= box.clientWidth + SUBPIXEL_TOLERANCE_PX) continue;
    clippedTexts.push({
      selector: describe(element),
      text: text.slice(0, 60),
      clippedPx: box.scrollWidth - box.clientWidth,
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
    });
  }

  // ----------------------------------------------------------- occluded text
  const occludedTexts: OccludedText[] = [];
  const textCandidates: Element[] = [];
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (textCandidates.length >= MAX_TEXT_PROBES) break;
    if (isPageShell(element)) continue;
    if (!ownText(element)) continue;
    if (!isVisible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    textCandidates.push(element);
  }
  for (const element of textCandidates) {
    if (occludedTexts.length >= MAX_REPORTED) break;
    const rect = element.getBoundingClientRect();
    let samples = 0;
    let occludedSamples = 0;
    let occluder = '';
    for (let column = 1; column <= 3; column += 1) {
      for (let row = 1; row <= 3; row += 1) {
        const x = rect.left + (rect.width * column) / 4;
        const y = rect.top + (rect.height * row) / 4;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        samples += 1;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit === element || element.contains(hit) || hit.contains(element)) continue;
        // Scrollable-away overlays (the fixed mobile bottom nav, the fixed
        // sidebar) are not this rule's business. The sidebar has rule 2.
        if (isScrollableAwayOverlay(hit)) continue;
        if (hit.closest('.sidebar')) continue;
        occludedSamples += 1;
        if (!occluder) occluder = describe(hit);
      }
    }
    if (samples < 4 || occludedSamples < samples) continue;
    occludedTexts.push({
      selector: describe(element),
      text: ownText(element).slice(0, 60),
      samples,
      occludedSamples,
      occluder,
    });
  }

  // ------------------------------------------------------------ form controls
  const formControls: FormControlMeasurement[] = [];
  for (const element of Array.from(document.querySelectorAll(FORM_CONTROL_SELECTOR))) {
    if (formControls.length >= MAX_FORM_CONTROLS_REPORTED) break;
    if (!isVisible(element)) continue;
    const control = element as HTMLInputElement;

    let labelElement: Element | null = null;
    let accessibleName = (control.getAttribute('aria-label') || '').trim();
    const labelledBy = control.getAttribute('aria-labelledby');
    if (labelledBy) {
      const referenced = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => node !== null);
      if (referenced.length > 0) {
        labelElement = referenced[0]!;
        if (!accessibleName) accessibleName = referenced.map((node) => labelOf(node)).join(' ');
      }
    }
    if (!labelElement) {
      const associated =
        control.labels && control.labels.length > 0 ? control.labels[0]! : control.closest('label');
      if (associated) {
        labelElement = associated;
        if (!accessibleName) accessibleName = labelOf(associated);
      }
    }
    if (!accessibleName) accessibleName = (control.getAttribute('title') || '').trim();

    let labelOverflowPx = 0;
    let labelSide: 'start' | 'end' | 'none' = 'none';
    if (labelElement && isVisible(labelElement)) {
      const labelRect = labelElement.getBoundingClientRect();
      if (labelRect.right > window.innerWidth + SUBPIXEL_TOLERANCE_PX) {
        labelOverflowPx = round(labelRect.right - window.innerWidth);
        labelSide = 'end';
      } else if (labelRect.left < -SUBPIXEL_TOLERANCE_PX) {
        labelOverflowPx = round(-labelRect.left);
        labelSide = 'start';
      }
    }

    formControls.push({
      selector: describe(control),
      accessibleName: accessibleName.trim().slice(0, 60),
      hasLabelElement: labelElement !== null,
      labelSelector: labelElement ? describe(labelElement) : '',
      labelText: labelElement ? labelOf(labelElement) : '',
      labelOverflowPx,
      labelSide,
    });
  }

  return {
    url: window.location.pathname + window.location.search,
    viewportWidth,
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    sidebar: sidebarRect
      ? {
          x: round(sidebarRect.x),
          y: round(sidebarRect.y),
          width: round(sidebarRect.width),
          height: round(sidebarRect.height),
        }
      : null,
    overflowOffenders,
    sidebarOverlaps,
    buttons,
    actionRows,
    touchTargets,
    clippedTexts,
    occludedTexts,
    formControls,
  };
}

/**
 * The failure conditions of gate §2, applied to a snapshot.
 * Every message carries the measured number that produced it.
 *
 * Rules 1-5 are the original release-gate five. Rules 6-8 were added for
 * R4-04, when the payroll wizard was finally brought into the matrix: text cut
 * off, text painted over, and a field whose caption the user cannot read. They
 * are appended rather than interleaved so the first five keep their positions
 * in the list, which the self-test asserts on by index.
 */
export function findLayoutViolations(snapshot: LayoutSnapshot): string[] {
  const violations: string[] = [];

  // 1. Horizontal overflow.
  //
  // R4-04: the original rule fired only when `documentScrollWidth` grew, and
  // below 761px it never can — global.css sets `overflow-x: clip` on
  // html/body/#root there. At 360/390/430, the widths this item is about, the
  // rule was therefore unable to fail. An offender that reaches past a
  // viewport edge is now a violation in its own right, whether or not the page
  // grew a scrollbar. RTL: `side` is measured on both edges, because in a
  // right-to-left page the leading edge is the right one and a spill there is
  // just as real as a spill at the left.
  const worstOffenders = [...snapshot.overflowOffenders]
    .sort((a, b) => b.overflowPx - a.overflowPx)
    .slice(0, 5)
    .map((offender) => `${offender.selector} (+${offender.overflowPx}px ${offender.side})`);
  if (snapshot.documentScrollWidth > snapshot.innerWidth) {
    violations.push(
      `גלישה אופקית: scrollWidth ${snapshot.documentScrollWidth} > innerWidth ${snapshot.innerWidth} ` +
        `(עודף ${snapshot.documentScrollWidth - snapshot.innerWidth}px)` +
        (worstOffenders.length > 0 ? ` — חשודים: ${worstOffenders.join(', ')}` : ''),
    );
  } else if (snapshot.overflowOffenders.length > 0) {
    violations.push(
      `גלישה אופקית מעבר לקצה המסך שנבלעה ב-overflow-x: clip של מעטפת העמוד ` +
        `(scrollWidth ${snapshot.documentScrollWidth} = innerWidth ${snapshot.innerWidth}, ` +
        `ולכן התוכן אינו נגלל ואינו נגיש) — ${snapshot.overflowOffenders.length} רכיבים חורגים: ` +
        worstOffenders.join(', '),
    );
  }

  // 2. An element swallowed by the fixed sidebar.
  for (const overlap of snapshot.sidebarOverlaps) {
    if (overlap.occludedSamples < overlap.samples) continue;
    violations.push(
      `רכיב חופף לסייד-בר ונסתר מאחוריו: ${overlap.selector}` +
        (overlap.text ? ` ["${overlap.text}"]` : '') +
        ` — חפיפה ${overlap.overlapWidth}×${overlap.overlapHeight}px, ` +
        `${overlap.occludedSamples}/${overlap.samples} נקודות בדיקה מוסתרות`,
    );
  }

  // 3. Text spilling out of the button that contains it.
  for (const button of snapshot.buttons) {
    if (button.clientWidth > 0 && button.scrollWidth > button.clientWidth + SUBPIXEL_TOLERANCE_PX) {
      violations.push(
        `טקסט גולש מגבולות הכפתור: ${button.selector} ["${button.text}"] — ` +
          `scrollWidth ${button.scrollWidth} > clientWidth ${button.clientWidth} ` +
          `(גלישה ${button.scrollWidth - button.clientWidth}px)`,
      );
      continue;
    }
    // RTL leading-edge overflow does not always raise scrollWidth, so measure the
    // rendered label against the space it was given. This is the "יציאה" defect.
    if (button.textWidth > button.contentWidth + SUBPIXEL_TOLERANCE_PX) {
      violations.push(
        `טקסט גולש מגבולות הכפתור: ${button.selector} ["${button.text}"] — ` +
          `רוחב טקסט ${button.textWidth}px > רוחב פנים הכפתור ${button.contentWidth}px ` +
          `(גלישה ${Math.round((button.textWidth - button.contentWidth) * 100) / 100}px)`,
      );
    }
  }

  // 4. Buttons on the same action row that are not the same size.
  for (const row of snapshot.actionRows) {
    const textButtons = row.buttons.filter((button) => button.isTextButton);
    if (textButtons.length < 2) continue;

    const heights = textButtons.map((button) => button.height);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    if (maxHeight - minHeight > SUBPIXEL_TOLERANCE_PX) {
      violations.push(
        `כפתורים באותה שורת פעולה בגבהים שונים: ${row.container} (top ${row.top}) — ` +
          `${textButtons.map((button) => `"${button.text}" ${button.height}px`).join(', ')} ` +
          `(פער ${Math.round((maxHeight - minHeight) * 100) / 100}px)`,
      );
    }

    if (!row.equalWidthContract) continue;
    const widths = textButtons.map((button) => button.width);
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);
    if (maxWidth - minWidth > SUBPIXEL_TOLERANCE_PX) {
      violations.push(
        `כפתורים באותה שורת פעולה ברוחבים שונים: ${row.container} (top ${row.top}) — ` +
          `${textButtons.map((button) => `"${button.text}" ${button.width}px`).join(', ')} ` +
          `(פער ${Math.round((maxWidth - minWidth) * 100) / 100}px)`,
      );
    }
  }

  // 5. Touch targets below the floor that applies at this width.
  //
  // R4-04: below 761px the repo's own stylesheet promises 48×48 for buttons,
  // role=button, summary and the listed link classes. Holding those to 44 at
  // 360px would let the matrix pass a control the product already declared too
  // small. Everything else keeps the 44px WCAG floor.
  const isMobileWidth = snapshot.viewportWidth <= MOBILE_TOUCH_TARGET_MAX_WIDTH_PX;
  for (const target of snapshot.touchTargets) {
    const floor =
      isMobileWidth && target.mobileStandard ? MOBILE_TOUCH_TARGET_PX : MIN_TOUCH_TARGET_PX;
    const smallest = Math.min(target.width, target.height);
    if (smallest >= floor) continue;
    violations.push(
      `מטרת מגע קטנה מ-${floor}px: ${target.selector}` +
        (target.text ? ` ["${target.text}"]` : '') +
        ` — ${target.width}×${target.height}px (חסר ${Math.round((floor - smallest) * 100) / 100}px)`,
    );
  }

  // 6. Text the browser cut off instead of wrapping.
  for (const clipped of snapshot.clippedTexts) {
    violations.push(
      `טקסט נחתך ואינו נגיש: ${clipped.selector} ["${clipped.text}"] — ` +
        `scrollWidth ${clipped.scrollWidth} > clientWidth ${clipped.clientWidth} ` +
        `(נחתך ${clipped.clippedPx}px, overflow-x מוסתר ואין גלילה)`,
    );
  }

  // 7. Text a foreign element paints over completely.
  for (const occluded of snapshot.occludedTexts) {
    violations.push(
      `טקסט מוסתר מאחורי רכיב אחר: ${occluded.selector} ["${occluded.text}"] — ` +
        `${occluded.occludedSamples}/${occluded.samples} נקודות בדיקה נחסמות על ידי ${occluded.occluder}`,
    );
  }

  // 8. A field whose caption the user cannot read.
  for (const control of snapshot.formControls) {
    if (!control.accessibleName) {
      violations.push(
        `פקד טופס ללא תווית נגישה: ${control.selector} — ` +
          `אין aria-label, אין aria-labelledby ואין <label> מקושר`,
      );
      continue;
    }
    if (control.labelOverflowPx > 0) {
      violations.push(
        `תווית של פקד טופס יוצאת מגבולות המסך: ${control.labelSelector} ` +
          `["${control.labelText}"] עבור ${control.selector} — ` +
          `חורגת ${control.labelOverflowPx}px בקצה ה-${control.labelSide}`,
      );
    }
  }

  return violations;
}

/** Turns violations into one assertion message that a reviewer can act on. */
export function formatViolationReport(width: number, route: string, violations: string[]): string {
  return [
    `מטריצת רוחבים — ${violations.length} כשלים ברוחב ${width}px, מסך ${route}:`,
    ...violations.map((violation, index) => `  ${index + 1}. ${violation}`),
  ].join('\n');
}
