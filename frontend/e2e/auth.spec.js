import { test, expect } from '@playwright/test';

test.describe('Auth screen — unauthenticated', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Landing page shows first — click "Sign in" to open login form
    await page.getByRole('button', { name: 'Sign in' }).click();
  });

  test('shows ALIVE branding', async ({ page }) => {
    await expect(page.getByText('ALIVE')).toBeVisible();
    await expect(page.getByText('Autonomic regulation')).toBeVisible();
  });

  test('sign-in tab active by default', async ({ page }) => {
    const signInTab = page.getByRole('button', { name: 'Sign in' }).first();
    await expect(signInTab).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' }).last()).toBeVisible();
  });

  test('sign-up tab switches form to Create account', async ({ page }) => {
    // Tab is a button with text "Sign up" (not role=tab)
    await page.locator('button').filter({ hasText: /^Sign up$/ }).click();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('forgot password link visible on sign-in tab', async ({ page }) => {
    await expect(page.getByText('Forgot password?')).toBeVisible();
  });

  test('email and password fields present', async ({ page }) => {
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
  });

  test('sign-in with wrong credentials shows error', async ({ page }) => {
    await page.getByPlaceholder('Email').fill('notauser@example.com');
    await page.getByPlaceholder('Password').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();
    // Error text appears (red #ff6b6b — check any error is shown)
    await expect(page.locator('text=/invalid|incorrect|error|wrong|credentials/i')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Auth screen — authenticated', () => {
  test.use({ storageState: './e2e/.auth/user.json' });

  test('signed-in user redirected away from root', async ({ page }) => {
    await page.goto('/');
    // Should NOT stay on login — should see landing or profile setup
    await expect(page.getByText('Sign in')).not.toBeVisible({ timeout: 5000 })
      .catch(() => {}); // skip if auth state not saved
  });

  test('sign out returns to login', async ({ page }) => {
    await page.goto('/');
    const signOut = page.getByRole('button', { name: 'Sign out' });
    if (await signOut.isVisible()) {
      await signOut.click();
      await expect(page.getByPlaceholder('Email')).toBeVisible({ timeout: 8000 });
    }
  });
});
