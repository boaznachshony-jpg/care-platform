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
}

/** The seven widths named by the release gate. */
export const MATRIX_WIDTHS = [360, 390, 430, 768, 1024, 1440, 2560] as const;

export const MIN_TOUCH_TARGET_PX = 44;

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

  // ---------------------------------------------------------------- overflow
  const overflowOffenders: OverflowOffender[] = [];
  const viewportWidth = window.innerWidth;
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (overflowOffenders.length >= MAX_REPORTED) break;
    if (element.tagName === 'HTML' || element.tagName === 'BODY') continue;
    if (!isVisible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (isParkedOffCanvas(element, rect)) continue;
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
  };
}

/**
 * The five failure conditions of gate §2, applied to a snapshot.
 * Every message carries the measured number that produced it.
 */
export function findLayoutViolations(snapshot: LayoutSnapshot): string[] {
  const violations: string[] = [];

  // 1. Horizontal overflow of the page itself.
  if (snapshot.documentScrollWidth > snapshot.innerWidth) {
    const worst = [...snapshot.overflowOffenders]
      .sort((a, b) => b.overflowPx - a.overflowPx)
      .slice(0, 5)
      .map((offender) => `${offender.selector} (+${offender.overflowPx}px ${offender.side})`);
    violations.push(
      `גלישה אופקית: scrollWidth ${snapshot.documentScrollWidth} > innerWidth ${snapshot.innerWidth} ` +
        `(עודף ${snapshot.documentScrollWidth - snapshot.innerWidth}px)` +
        (worst.length > 0 ? ` — חשודים: ${worst.join(', ')}` : ''),
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

  // 5. Touch targets below 44px.
  for (const target of snapshot.touchTargets) {
    const smallest = Math.min(target.width, target.height);
    if (smallest >= MIN_TOUCH_TARGET_PX) continue;
    violations.push(
      `מטרת מגע קטנה מ-${MIN_TOUCH_TARGET_PX}px: ${target.selector}` +
        (target.text ? ` ["${target.text}"]` : '') +
        ` — ${target.width}×${target.height}px (חסר ${Math.round((MIN_TOUCH_TARGET_PX - smallest) * 100) / 100}px)`,
    );
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
