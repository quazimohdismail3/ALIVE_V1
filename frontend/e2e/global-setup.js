import { chromium } from '@playwright/test';

const BASE_URL = 'https://mission-alive.vercel.app';
const AUTH_FILE = './e2e/.auth/user.json';

export default async function globalSetup() {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  if (!email || !password) {
    console.warn('[global-setup] TEST_USER_EMAIL / TEST_USER_PASSWORD not set — auth-required tests will skip');
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(BASE_URL);
  // Landing page shows first — click "Sign in" to reveal login form
  await page.getByText('Sign in').click();
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.locator('button[type="submit"]').click();

  // SPA never changes URL — wait for Email input to disappear (auth complete)
  await page.waitForSelector('input[placeholder="Email"]', { state: 'hidden', timeout: 15000 })
    .catch(() => {
      throw new Error('[global-setup] Login did not complete — check TEST_USER_EMAIL/TEST_USER_PASSWORD');
    });

  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();
}
