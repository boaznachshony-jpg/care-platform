/* eslint-disable no-restricted-syntax -- E2E locators assert the Hebrew product contract */
import { expect, type Page } from '@playwright/test';

/**
 * Seeds the transitional profile, then enters it through the same visible
 * client-list action a user uses. `/app` is deliberately treated as the
 * client list, never as an active-case dashboard.
 */
export async function enterSeededClient(
  page: Page,
  profile: unknown,
  { clearStorage = false }: { clearStorage?: boolean } = {},
): Promise<string> {
  await page.goto('/app');
  await page.evaluate(
    ({ seededProfile, clear }) => {
      if (clear) localStorage.clear();
      localStorage.setItem('caredesk.mvp.profile.v1', JSON.stringify(seededProfile));
    },
    { seededProfile: profile, clear: clearStorage },
  );

  // Allow the legacy-profile migration to materialize the seeded client, then
  // return to the list and enter through its public UI contract.
  await page.reload();
  await page.goto('/app');
  await page.getByRole('button', { name: 'כניסה לתיק' }).click();
  await expect(page).toHaveURL(/\/clients\/[^/]+$/);
  return page.url();
}
