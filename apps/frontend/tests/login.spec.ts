import { expect, test } from '@playwright/test';

  test.describe('Login flow', () => {
    test('should allow user to log in with valid credentials', async ({ page }) => {
      await page.goto('/');

      const skipButton = page.getByRole('button', { name: 'Skip setup for now' });
      const conversationsLink = page.getByRole('link', { name: 'Conversations', exact: true });

      // Once the hub's setup tasks load, the app sends an admin of an unfinished hub to /hub/setup
      // instead of the dashboard. Wait until it has settled on one of the two before checking.
      await expect(skipButton.or(conversationsLink)).toBeVisible({ timeout: 15000 });

      if (await skipButton.isVisible()) {
        await skipButton.click();
      }

      await expect(page).toHaveTitle(/Dashboard/);
      await expect(conversationsLink).toBeVisible();
    });
});
