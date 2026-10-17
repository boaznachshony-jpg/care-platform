/* eslint-disable no-restricted-syntax -- locators and synthetic fixtures assert unchanged Hebrew product copy */
import { devices, expect, test, type Page, type Route } from '@playwright/test';
import {
  importTaskRequestSchema,
  updateTaskRequestSchema,
  importMedicationRequestSchema,
  updateMedicationRequestSchema,
  type TaskResponse,
  type MedicationResponse,
} from '@caredesk/schemas';
import { installCanonicalProductIntelligence } from './fixtures/canonical-product-intelligence.js';
import { enterSeededClient } from './fixtures/seeded-client.js';
import {
  MATRIX_WIDTHS,
  collectLayoutSnapshot,
  findLayoutViolations,
  formatViolationReport,
} from './fixtures/layout-matrix.js';

const baselineOrigin = `http://127.0.0.1:${process.env.VISUAL_BASELINE_PORT ?? 6177}`;
const visualOrigin = `http://127.0.0.1:${process.env.VISUAL_TEST_PORT ?? 6178}`;
const serverTaskTitle = 'משימה סינתטית שנקראה מהשרת';
const serverMedicationName = 'תרופה סינתטית שנקראה מהשרת';
const profile = {
  employerName: 'מעסיק בדיקת עיצוב',
  employerIdNumber: '123456782',
  employerPhone: '0501234567',
  recipientName: 'מטופל בדיקת עיצוב',
  caregiverName: 'Caregiver Test',
  caregiverCountry: 'אוזבקיסטן',
  caregiverLanguage: 'אוזבקית',
  employmentStartDate: '2026-01-15',
  representativeName: 'נציג בדיקה',
  representativePhone: '0521234567',
  licensedBureauName: 'תאגיד בדיקה',
  licensedBureauRegistrationNumber: 'LB-1001',
  licensedBureauContactName: 'איש קשר',
  licensedBureauContactPhone: '0531234567',
  licensedBureauContactEmail: 'visual@example.test',
  notificationsEnabled: true,
  reminderLeadDays: 7,
  quietHoursStart: '21:00',
  quietHoursEnd: '08:00',
  onboardingCompleted: true,
  employmentAgreementConfirmed: true,
  medicalInsuranceConfirmed: true,
  medicalInsuranceExpiryDate: '2027-06-30',
  baseSalary: 7000,
  salaryEffectiveDate: '2026-01-15',
  saturdayRate: 440,
  licenseRenewalDate: '2027-01-15',
  visaRenewalDate: '2026-12-31',
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

/** Browser HTTP contract state only. No auth/RLS/DB durability is claimed. */
async function installExistingContracts(page: Page) {
  // Specific routes registered below win. An omitted contract must never reach
  // a developer's independently running API instance on this loopback port.
  await page.route('http://127.0.0.1:4000/**', (route) => route.abort('blockedbyclient'));
  await installCanonicalProductIntelligence(page);
  // A server-origin row proves that the UI has actually merged a successful
  // GET response; a request counter alone only proves that fetching started.
  const taskId = '40000000-0000-4000-8000-000000009001';
  const tasks = new Map<string, TaskResponse>([
    [
      taskId,
      {
        id: taskId,
        title: serverTaskTitle,
        titleKey: null,
        description: null,
        status: 'open',
        priority: 'normal',
        dueAt: '2026-07-21T00:00:00.000Z',
        completedAt: null,
        sourceType: 'manual',
        legacyLocalId: null,
      },
    ],
  ]);
  const medicationId = '50000000-0000-4000-8000-000000009001';
  const medications = new Map<string, MedicationResponse>([
    [
      medicationId,
      {
        id: medicationId,
        name: serverMedicationName,
        dosage: 'נתון בדיקה בלבד',
        timesOfDay: ['morning'],
        daily: true,
        daysOfWeek: null,
        prescribingDoctor: '',
        notes: '',
        status: 'active',
        legacyLocalId: null,
      },
    ],
  ]);
  let reads = 0;
  await page.route(
    /\/cases\/[^/]+\/tasks(?:\/(?:import|[^/]+(?:\/(?:complete|archive))?))?(?:\?.*)?$/,
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        reads += 1;
        return json(
          route,
          [...tasks.values()].filter((task) => task.status !== 'cancelled'),
        );
      }
      if (path.endsWith('/import') && request.method() === 'POST') {
        const parsed = importTaskRequestSchema.safeParse(request.postDataJSON());
        if (!parsed.success) return json(route, { code: 'VALIDATION_ERROR' }, 400);
        const input = parsed.data;
        const existing = [...tasks.values()].find(
          (task) => task.legacyLocalId === input.legacyLocalId,
        );
        if (existing) return json(route, existing);
        const task: TaskResponse = {
          id: `40000000-0000-4000-8000-${String(tasks.size + 1).padStart(12, '0')}`,
          title: input.title,
          titleKey: null,
          description: input.description ?? null,
          status: input.status,
          priority: input.priority,
          legacyLocalId: input.legacyLocalId,
          dueAt: input.dueDate ? `${input.dueDate}T00:00:00.000Z` : null,
          completedAt: input.status === 'completed' ? '2026-07-15T12:00:00.000Z' : null,
          sourceType: 'manual',
        };
        tasks.set(task.id, task);
        return json(route, task, 201);
      }
      const id = /\/tasks\/([^/]+)/.exec(path)?.[1];
      const existing = id ? tasks.get(id) : undefined;
      if (!existing) return json(route, { code: 'NOT_FOUND' }, 404);
      if (request.method() === 'PATCH') {
        const parsed = updateTaskRequestSchema.safeParse(request.postDataJSON());
        if (!parsed.success) return json(route, { code: 'VALIDATION_ERROR' }, 400);
        const { dueDate, ...fields } = parsed.data;
        Object.assign(existing, fields);
        if (dueDate !== undefined)
          existing.dueAt = dueDate === null ? null : `${dueDate}T00:00:00.000Z`;
        return json(route, existing);
      }
      if (request.method() === 'POST' && path.endsWith('/complete')) {
        existing.status = 'completed';
        existing.completedAt = '2026-07-15T12:00:00.000Z';
        return json(route, existing);
      }
      if (request.method() === 'POST' && path.endsWith('/archive')) {
        existing.status = 'cancelled';
        return json(route, existing);
      }
      return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    },
  );
  await page.route(
    /\/cases\/[^/]+\/medications(?:\/(?:import|[^/]+(?:\/archive)?))?(?:\?.*)?$/,
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        reads += 1;
        return json(
          route,
          [...medications.values()].filter((medication) => medication.status === 'active'),
        );
      }
      if (path.endsWith('/import') && request.method() === 'POST') {
        const parsed = importMedicationRequestSchema.safeParse(request.postDataJSON());
        if (!parsed.success) return json(route, { code: 'VALIDATION_ERROR' }, 400);
        const input = parsed.data;
        const existing = [...medications.values()].find(
          (medication) => medication.legacyLocalId === input.legacyLocalId,
        );
        if (existing) return json(route, existing);
        const medication: MedicationResponse = {
          ...input,
          id: `50000000-0000-4000-8000-${String(medications.size + 1).padStart(12, '0')}`,
          daysOfWeek: input.daysOfWeek ?? null,
          status: 'active',
        };
        medications.set(medication.id, medication);
        return json(route, medication, 201);
      }
      const id = /\/medications\/([^/]+)/.exec(path)?.[1];
      const existing = id ? medications.get(id) : undefined;
      if (!existing) return json(route, { code: 'NOT_FOUND' }, 404);
      if (request.method() === 'PATCH') {
        const parsed = updateMedicationRequestSchema.safeParse(request.postDataJSON());
        if (!parsed.success) return json(route, { code: 'VALIDATION_ERROR' }, 400);
        Object.assign(existing, parsed.data);
        return json(route, existing);
      }
      if (request.method() === 'POST' && path.endsWith('/archive')) {
        existing.status = 'archived';
        return json(route, existing);
      }
      return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    },
  );
  return {
    reads: () => reads,
    tasks: () => [...tasks.values()],
    medications: () => [...medications.values()],
  };
}

async function openClient(page: Page, origin: string) {
  await page.clock.setFixedTime(new Date('2026-07-15T12:00:00.000Z'));
  const api = await installExistingContracts(page);
  // enterSeededClient uses existing profile migration. Supply its relative /app
  // visits with this context's origin, never a production URL.
  const clientHome = await enterSeededClient(page, profile, { clearStorage: true });
  expect(new URL(clientHome).origin).toBe(origin);
  return { api, clientHome };
}

async function semantics(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (/^\/clients\/[^/]+\/?$/.test(new URL(page.url()).pathname)) {
    await expect(page.getByLabel('75 מתוך 100', { exact: true })).toBeVisible();
  }
  return page.evaluate(() => {
    const text = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
    const name = (element: Element) => {
      const labelled = element.getAttribute('aria-label');
      const control = element as HTMLInputElement;
      return text(
        labelled ??
          (control.labels
            ? [...control.labels].map((label) => label.textContent).join(' ')
            : element.textContent),
      );
    };
    return {
      text: text(document.body.textContent),
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((element) => [
        element.tagName,
        text(element.textContent),
      ]),
      controls: [...document.querySelectorAll('button,a,input,select,textarea,summary')].map(
        (element) => ({
          tag: element.tagName,
          type: element.getAttribute('type'),
          name: name(element),
          href: element.getAttribute('href')?.replace(/\/clients\/[^/?#]+/g, '/clients/:id'),
          value:
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
              ? element.value
              : undefined,
          checked: element instanceof HTMLInputElement ? element.checked : undefined,
          disabled: 'disabled' in element ? Boolean(element.disabled) : undefined,
        }),
      ),
    };
  });
}

async function palette(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const surface = document.querySelector('.topbar, .client-card');
    return {
      canvasToken: root.getPropertyValue('--cd-canvas').trim().toLowerCase(),
      surfaceToken: root.getPropertyValue('--cd-surface').trim().toLowerCase(),
      primaryToken: root.getPropertyValue('--cd-primary').trim().toLowerCase(),
      canvasPaint: getComputedStyle(document.body).backgroundColor,
      surfacePaint: surface ? getComputedStyle(surface).backgroundColor : null,
    };
  });
}

async function approvedPalette(page: Page) {
  const dark = (await page.locator('html').getAttribute('data-theme')) === 'dark';
  const actual = await palette(page);
  // These literals are the reviewed approved.css palette, not generated CSS
  // identifiers. Both token values and painted surfaces must be in effect.
  expect(actual).toEqual(
    dark
      ? {
          canvasToken: '#181e19',
          surfaceToken: '#232b25',
          primaryToken: '#c6e38a',
          canvasPaint: 'rgb(24, 30, 25)',
          surfacePaint: 'rgb(35, 43, 37)',
        }
      : {
          canvasToken: '#f2f3ed',
          surfaceToken: '#ffffff',
          primaryToken: '#365e40',
          canvasPaint: 'rgb(242, 243, 237)',
          surfacePaint: 'rgb(255, 255, 255)',
        },
  );
  return actual;
}

/** Prove the real label target before using its dimensions for a native choice. */
async function choiceHitAreas(page: Page) {
  const choices = page.locator('input[type="checkbox"], input[type="radio"]');
  const count = await choices.count();
  const initialSelection = await choices.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).checked),
  );
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const proven = [];
  for (let index = 0; index < count; index += 1) {
    const input = choices.nth(index);
    if (!(await input.isVisible()) || (await input.isDisabled())) continue;
    const box = await input.boundingBox();
    if (!box || (box.width >= 44 && box.height >= 44)) continue;
    const originalChecked = await input.isChecked();
    const group = await input.evaluate((element) => {
      const choice = element as HTMLInputElement;
      if (choice.type !== 'radio') return null;
      const all = [
        ...document.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"], input[type="radio"]',
        ),
      ];
      const peers = all.filter(
        (item) => item.type === 'radio' && item.name === choice.name && item.form === choice.form,
      );
      return {
        selected: all.findIndex((item) => peers.includes(item) && item.checked),
        alternative: all.findIndex(
          (item) => peers.includes(item) && !item.checked && !item.disabled,
        ),
      };
    });
    if (group) {
      expect(
        group.selected,
        'Radio proof needs an existing selection to restore',
      ).toBeGreaterThanOrEqual(0);
      if (originalChecked) {
        expect(group.alternative).toBeGreaterThanOrEqual(0);
        await choices.nth(group.alternative).check();
        await expect(input).not.toBeChecked();
      }
    }
    await input.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
    );
    const area = await input.evaluate((element) => {
      const choice = element as HTMLInputElement;
      const label = choice.labels?.[0];
      if (!label) return null;
      const rect = label.getBoundingClientRect();
      const glyph = choice.getBoundingClientRect();
      const parts: string[] = [];
      let node: Element | null = choice;
      // Match the existing measurement's diagnostic selector, without changing it.
      for (let depth = 0; node && depth < 3; depth += 1) {
        let part = node.tagName.toLowerCase();
        if (node.id) part += '#' + node.id;
        const classes = (typeof node.className === 'string' ? node.className : '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2);
        for (const className of classes) part += '.' + className;
        parts.unshift(part);
        node = node.parentElement;
      }
      let point: { x: number; y: number } | undefined;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const x = rect.left + rect.width * fraction;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const insideGlyph =
          x >= glyph.left && x <= glyph.right && y >= glyph.top && y <= glyph.bottom;
        if (
          hit &&
          label.contains(hit) &&
          !insideGlyph &&
          !hit.closest('a,button,select,textarea')
        ) {
          point = { x, y };
          break;
        }
      }
      return {
        selector: parts.join(' > '),
        label: label.textContent?.trim(),
        inputWidth: Math.round(glyph.width * 100) / 100,
        inputHeight: Math.round(glyph.height * 100) / 100,
        width: rect.width,
        height: rect.height,
        point,
      };
    });
    expect(area, 'An undersized native choice requires an associated label').not.toBeNull();
    expect(area!.width, area!.label).toBeGreaterThanOrEqual(44);
    expect(area!.height, area!.label).toBeGreaterThanOrEqual(44);
    expect(
      area!.point,
      `No unobstructed label hit point outside the glyph: ${area!.label}`,
    ).toBeDefined();
    await page.mouse.click(area!.point!.x, area!.point!.y);
    await expect(input).toBeChecked({ checked: group ? true : !originalChecked });
    if (group) await choices.nth(group.selected).check();
    else await input.setChecked(originalChecked);
    await expect(input).toBeChecked({ checked: originalChecked });
    proven.push(area!);
  }
  await expect(choices).toHaveCount(count);
  expect(
    await choices.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLInputElement).checked),
    ),
  ).toEqual(initialSelection);
  await page.evaluate(
    ({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
    scroll,
  );
  return proven;
}

async function audit(page: Page, width: number, screen: string) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await approvedPalette(page);
  const proven = await choiceHitAreas(page);
  const snapshot = await page.evaluate(collectLayoutSnapshot);
  // Only choices whose actual label click just toggled the existing controlled
  // input may use the associated target. Every other measurement stays intact.
  for (const area of proven) {
    const target = snapshot.touchTargets.find(
      (item) =>
        item.selector === area.selector &&
        item.width === area.inputWidth &&
        item.height === area.inputHeight,
    );
    expect(target, `Proven choice missing from measured targets: ${area.label}`).toBeDefined();
    target!.width = area.width;
    target!.height = area.height;
  }
  expect(snapshot.buttons.length + snapshot.touchTargets.length).toBeGreaterThan(0);
  expect(
    findLayoutViolations(snapshot),
    formatViolationReport(width, screen, findLayoutViolations(snapshot)),
  ).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

for (const width of [390, 1440]) {
  test(`visual-only parity and existing actions at ${width}px`, async ({ browser }, testInfo) => {
    test.slow();
    const device = width === 390 ? devices['Pixel 7'] : devices['Desktop Chrome'];
    const baseline = await browser.newContext({
      ...device,
      baseURL: baselineOrigin,
      viewport: { width, height: 900 },
      locale: 'he-IL',
    });
    const visual = await browser.newContext({
      ...device,
      baseURL: visualOrigin,
      viewport: { width, height: 900 },
      locale: 'he-IL',
    });
    try {
      const results = [];
      const styleResults = [];
      const excludedStyles = [];
      const motionResults = [];
      for (const [context, origin, enabled] of [
        [baseline, baselineOrigin, false],
        [visual, visualOrigin, true],
      ] as const) {
        const page = await context.newPage();
        const { api, clientHome } = await openClient(page, origin);
        const checkpoints = [];
        await expect(page.locator('html')).toHaveClass(
          enabled ? /ux-v2-visual/ : /^(?!.*ux-v2-visual)/,
        );
        checkpoints.push(await semantics(page));
        await page.screenshot({
          path: testInfo.outputPath(`${enabled ? 'after' : 'before'}-home-${width}.png`),
          fullPage: true,
        });
        const light = enabled ? await approvedPalette(page) : await palette(page);
        await page.getByRole('button', { name: 'מעבר בין תצוגה בהירה לכהה' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const dark = enabled ? await approvedPalette(page) : await palette(page);
        styleResults.push({ light, dark });
        await page.getByRole('button', { name: 'מעבר בין תצוגה בהירה לכהה' }).click();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
        await page.goto(`${origin}/app`);
        checkpoints.push(await semantics(page));
        // The existing secondary actions live on the client entry; the home
        // dashboard has no secondary-button. Exercise the actual controls.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        ).toBe(true);
        const secondary = page.locator('.secondary-button').filter({ visible: true });
        expect(await secondary.count()).toBeGreaterThan(0);
        const durations = await secondary.evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).transitionDuration),
        );
        expect(durations.every((duration) => duration === '0s')).toBe(true);
        await secondary.first().hover();
        expect(await secondary.first().evaluate((element) => element.matches(':hover'))).toBe(true);
        await expect(secondary.first()).toHaveCSS('transform', 'none');
        expect(await semantics(page)).toEqual(checkpoints.at(-1));
        motionResults.push({
          durations,
          transform: await secondary
            .first()
            .evaluate((element) => getComputedStyle(element).transform),
        });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        expect(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        ).toBe(false);
        await page.mouse.move(1, 1);
        expect(await semantics(page)).toEqual(checkpoints.at(-1));
        await page.getByRole('button', { name: 'כניסה לתיק' }).click();
        await expect(page).toHaveURL(clientHome);
        await page.goto(`${clientHome}/tasks`);
        await expect(page.getByRole('heading', { name: 'מה צריך לבצע' })).toBeVisible();
        await expect.poll(api.reads).toBeGreaterThan(0);
        await expect(
          page.getByRole('heading', { name: serverTaskTitle, exact: true }),
        ).toBeVisible();
        checkpoints.push(await semantics(page));
        await page.screenshot({
          path: testInfo.outputPath(`${enabled ? 'after' : 'before'}-tasks-${width}.png`),
          fullPage: true,
        });
        await page.getByRole('button', { name: /משימה חדשה/ }).click();
        await page.getByLabel('מה צריך לבצע?').fill('משימת בדיקת עיצוב');
        await page.getByLabel('מועד יעד').fill('2026-07-20');
        await page.getByLabel('עדיפות').selectOption('important');
        checkpoints.push(await semantics(page));
        if (enabled) {
          await audit(page, width, 'task form');
          await page.screenshot({
            path: testInfo.outputPath(`tasks-form-${width}.png`),
            fullPage: true,
          });
        }
        await page.getByRole('button', { name: 'שמירת המשימה' }).click();
        await expect
          .poll(() => api.tasks().some((task) => task.title === 'משימת בדיקת עיצוב'))
          .toBe(true);
        const task = page.getByRole('article').filter({ hasText: 'משימת בדיקת עיצוב' });
        await task.getByRole('button', { name: 'השלמת משימת בדיקת עיצוב' }).click();
        await page.getByRole('button', { name: 'הושלמו', exact: true }).click();
        await expect(task).toBeVisible();
        await expect
          .poll(() =>
            api
              .tasks()
              .some((item) => item.title === 'משימת בדיקת עיצוב' && item.status === 'completed'),
          )
          .toBe(true);
        checkpoints.push(await semantics(page));
        await task.getByRole('button', { name: 'החזרת משימת בדיקת עיצוב' }).click();
        await page.getByRole('button', { name: 'פתוחות', exact: true }).click();
        await expect(task).toBeVisible();
        await page.reload();
        await expect(task).toBeVisible();
        checkpoints.push(await semantics(page));

        await page.goto(`${clientHome}/medications`);
        await expect(
          page.getByRole('heading', { name: 'תרופות קבועות', exact: true }),
        ).toBeVisible();
        await expect(
          page.locator('.medications-list > li').filter({ hasText: serverMedicationName }),
        ).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath(`${enabled ? 'after' : 'before'}-medications-${width}.png`),
          fullPage: true,
        });
        await page.getByLabel('שם התרופה', { exact: true }).fill('תרופת בדיקה');
        await page.getByLabel('מינון', { exact: true }).fill('מינון שהוזן לבדיקה');
        await page.getByLabel('בוקר', { exact: true }).check();
        await page.getByLabel('נלקחת כל יום').uncheck();
        await page.getByLabel('ראשון', { exact: true }).check();
        checkpoints.push(await semantics(page));
        if (enabled) {
          await audit(page, width, 'medication form');
          await page.screenshot({
            path: testInfo.outputPath(`medications-form-${width}.png`),
            fullPage: true,
          });
        }
        await page.getByRole('button', { name: 'הוספה', exact: true }).click();
        await expect
          .poll(() => api.medications().some((item) => item.name === 'תרופת בדיקה'))
          .toBe(true);
        await page.reload();
        const medication = page
          .locator('.medications-list > li')
          .filter({ hasText: 'תרופת בדיקה' });
        await expect(medication).toContainText('ראשון');
        await medication.getByRole('button', { name: 'עריכה', exact: true }).click();
        await page.getByLabel('מינון', { exact: true }).fill('מינון מעודכן לבדיקה');
        await page.getByRole('button', { name: 'שמירה', exact: true }).click();
        await expect
          .poll(() => api.medications().some((item) => item.dosage === 'מינון מעודכן לבדיקה'))
          .toBe(true);
        checkpoints.push(await semantics(page));

        // The existing shell link changes the route without reloading React.
        if (width < 761) {
          await page.getByRole('button', { name: 'עוד', exact: true }).click();
          await page
            .getByRole('navigation', { name: 'ניווט נוסף' })
            .getByRole('link', { name: 'הגדרות' })
            .click();
        } else {
          await page.locator('a[href$="/settings"]').filter({ visible: true }).click();
        }
        await expect(page).toHaveURL(`${clientHome}/settings`);
        await expect(page.locator('html')).not.toHaveClass(/ux-v2-visual/);
        checkpoints.push(await semantics(page));
        excludedStyles.push(await palette(page));
        results.push(checkpoints);
      }
      expect(results[1]).toEqual(results[0]);
      expect(styleResults[1]!.light.canvasPaint).not.toBe(styleResults[0]!.light.canvasPaint);
      expect(styleResults[1]!.dark.canvasPaint).not.toBe(styleResults[0]!.dark.canvasPaint);
      expect(excludedStyles[1]).toEqual(excludedStyles[0]);
      expect(motionResults[1]).toEqual(motionResults[0]);
    } finally {
      await baseline.close();
      await visual.close();
    }
  });
}

for (const width of MATRIX_WIDTHS) {
  test(`TEST visual layout and preferences at ${width}px`, async ({ browser }, testInfo) => {
    test.slow();
    const context = await browser.newContext({
      baseURL: visualOrigin,
      viewport: { width, height: width <= 430 ? 844 : 1024 },
      locale: 'he-IL',
    });
    try {
      const page = await context.newPage();
      const { clientHome } = await openClient(page, visualOrigin);
      await page.goto(`${visualOrigin}/app`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await audit(page, width, 'client entry light');
      await page.screenshot({
        path: testInfo.outputPath(`client-entry-light-${width}.png`),
        fullPage: true,
      });
      for (const [suffix, name] of [
        ['', 'home'],
        ['/tasks', 'tasks'],
        ['/medications', 'medications'],
      ] as const) {
        await page.goto(`${clientHome}${suffix}`);
        await expect(page.locator('html')).toHaveClass(/ux-v2-visual/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (name === 'home')
          await expect(page.getByLabel('75 מתוך 100', { exact: true })).toBeVisible();
        if (name === 'tasks')
          await expect(
            page.getByRole('heading', { name: serverTaskTitle, exact: true }),
          ).toBeVisible();
        if (name === 'medications')
          await expect(
            page.locator('.medications-list > li').filter({ hasText: serverMedicationName }),
          ).toBeVisible();
        await audit(page, width, name);
        await page.screenshot({
          path: testInfo.outputPath(`${name}-light-${width}.png`),
          fullPage: true,
        });
        if (name === 'tasks') {
          await page.getByRole('button', { name: /משימה חדשה/ }).click();
          await audit(page, width, 'task form light');
          await page.screenshot({
            path: testInfo.outputPath(`task-form-light-${width}.png`),
            fullPage: true,
          });
          await page.getByRole('button', { name: 'סגירה', exact: true }).click();
        }
      }
      await page.getByRole('button', { name: 'הגדלת טקסט' }).click();
      await page.getByRole('button', { name: 'הגדלת טקסט' }).click();
      await expect(page.locator('html')).toHaveCSS('--ui-scale', '1.3');
      await page.getByRole('button', { name: 'מעבר בין תצוגה בהירה לכהה' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      // Use the existing client-switch navigation: the entry has no separate
      // preference controls, and this keeps the real shell-selected settings.
      if (width < 761) {
        await page.getByRole('button', { name: 'עוד', exact: true }).click();
        await page
          .getByRole('navigation', { name: 'ניווט נוסף' })
          .getByRole('link', { name: 'החלפת מעסיק', exact: true })
          .click();
      } else {
        await page.getByRole('link', { name: 'החלפת מעסיק', exact: true }).click();
      }
      await expect(page).toHaveURL(`${visualOrigin}/app`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.locator('html')).toHaveCSS('--ui-scale', '1.3');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await audit(page, width, 'client entry dark enlarged');
      await page.screenshot({
        path: testInfo.outputPath(`client-entry-dark-enlarged-${width}.png`),
        fullPage: true,
      });
      for (const [suffix, name] of [
        ['', 'home'],
        ['/tasks', 'tasks'],
        ['/medications', 'medications'],
      ] as const) {
        await page.goto(`${clientHome}${suffix}`);
        await expect(page.locator('html')).toHaveCSS('--ui-scale', '1.3');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        if (name === 'home')
          await expect(page.getByLabel('75 מתוך 100', { exact: true })).toBeVisible();
        if (name === 'tasks')
          await expect(
            page.getByRole('heading', { name: serverTaskTitle, exact: true }),
          ).toBeVisible();
        if (name === 'medications')
          await expect(
            page.locator('.medications-list > li').filter({ hasText: serverMedicationName }),
          ).toBeVisible();
        await audit(page, width, `${name} dark enlarged`);
        await page.screenshot({
          path: testInfo.outputPath(`${name}-dark-enlarged-${width}.png`),
          fullPage: true,
        });
        if (name === 'tasks') {
          await page.getByRole('button', { name: /משימה חדשה/ }).click();
          await audit(page, width, 'task form dark enlarged');
          await page.screenshot({
            path: testInfo.outputPath(`task-form-dark-enlarged-${width}.png`),
            fullPage: true,
          });
          await page.getByRole('button', { name: 'סגירה', exact: true }).click();
        }
      }
      const nameInput = page.getByLabel('שם התרופה', { exact: true });
      await nameInput.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('מינון', { exact: true })).toBeFocused();
      const focusStyle = await page.getByLabel('מינון', { exact: true }).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          focusVisible: element.matches(':focus-visible'),
          outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
          shadow: style.boxShadow !== 'none',
        };
      });
      expect(focusStyle.focusVisible).toBe(true);
      expect(focusStyle.outline || focusStyle.shadow).toBe(true);
      await page.goto(`${visualOrigin}/`);
      await expect(page.locator('html')).not.toHaveClass(/ux-v2-visual/);
    } finally {
      await context.close();
    }
  });
}
