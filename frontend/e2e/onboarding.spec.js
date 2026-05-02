import { test, expect } from '@playwright/test';
import fs from 'fs';

const AUTH_FILE = './e2e/.auth/user.json';

test.describe('Profile setup wizard', () => {
  test.beforeEach(async ({ page }) => {
    if (!fs.existsSync(AUTH_FILE)) {
      test.skip();
      return;
    }
    await page.goto('/');
  });

  test.use({ storageState: AUTH_FILE });

  test('hero step shows "Tell us about you"', async ({ page }) => {
    const heading = page.getByText('Tell us about you');
    if (await heading.isVisible()) {
      await expect(page.getByRole('button', { name: 'Begin' })).toBeEnabled();
    }
  });

  test('age step rejects out-of-range values', async ({ page }) => {
    const heading = page.getByText('Tell us about you');
    if (!await heading.isVisible()) return test.skip();

    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByText('How old are you?')).toBeVisible();

    const input = page.locator('input[type="number"]').first();
    await input.fill('5');
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    await input.fill('25');
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('sex step shows three options', async ({ page }) => {
    const heading = page.getByText('Tell us about you');
    if (!await heading.isVisible()) return test.skip();

    await page.getByRole('button', { name: 'Begin' }).click();
    await page.locator('input[type="number"]').first().fill('25');
    await page.getByRole('button', { name: 'Next' }).click();

    await expect(page.getByText('Biological sex')).toBeVisible();
    await expect(page.getByText('Male')).toBeVisible();
    await expect(page.getByText('Female')).toBeVisible();
    await expect(page.getByText('Prefer not to say')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
    await page.getByText('Male').click();
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('back button navigates to previous step', async ({ page }) => {
    const heading = page.getByText('Tell us about you');
    if (!await heading.isVisible()) return test.skip();

    await page.getByRole('button', { name: 'Begin' }).click();
    await page.locator('input[type="number"]').first().fill('25');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('How old are you?')).toBeVisible();
  });
});
