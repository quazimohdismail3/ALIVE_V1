/**
 * Diagnostic: capture console errors during sign-in flow
 * Run: npx playwright test e2e/debug-signin.js --reporter=line
 */
import { test, expect } from '@playwright/test';

const BASE_URL = 'https://mission-alive.vercel.app';

test('capture errors after sign-in', async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  // Click Sign in to reveal form
  await page.getByText('Sign in').click();
  await page.getByPlaceholder('Email').fill(process.env.TEST_USER_EMAIL);
  await page.getByPlaceholder('Password').fill(process.env.TEST_USER_PASSWORD);

  // Capture network failures around auth + profile calls
  const responses = [];
  page.on('response', res => {
    if (res.status() >= 400) {
      responses.push(`${res.status()} ${res.url()}`);
    }
  });

  await page.locator('button[type="submit"]').click();

  // Wait up to 10s for either error boundary text or dashboard to appear
  await Promise.race([
    page.waitForSelector('text=Something went wrong', { timeout: 10000 }).catch(() => null),
    page.waitForSelector('text=Dashboard', { timeout: 10000 }).catch(() => null),
    page.waitForSelector('text=Begin Session', { timeout: 10000 }).catch(() => null),
    page.waitForSelector('text=Could not reach server', { timeout: 10000 }).catch(() => null),
    page.waitForSelector('text=Set up your profile', { timeout: 10000 }).catch(() => null),
  ]);

  // Extra second to let errors surface
  await page.waitForTimeout(2000);

  // Capture page HTML snippet around the error
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  const title = await page.title();

  console.log('\n========== DIAGNOSTIC REPORT ==========');
  console.log('PAGE TITLE:', title);
  console.log('BODY TEXT (first 500 chars):', bodyText);
  console.log('\nPAGE ERRORS (uncaught throws):');
  if (pageErrors.length === 0) console.log('  (none)');
  pageErrors.forEach((e, i) => {
    console.log(`  [${i+1}] MESSAGE: ${e.message}`);
    console.log(`       STACK:\n${e.stack?.split('\n').slice(0,8).join('\n')}`);
  });
  console.log('\nCONSOLE ERRORS:');
  if (consoleErrors.length === 0) console.log('  (none)');
  consoleErrors.forEach((e, i) => console.log(`  [${i+1}] ${e}`));
  console.log('\nFAILED HTTP RESPONSES (4xx/5xx):');
  if (responses.length === 0) console.log('  (none)');
  responses.forEach((r, i) => console.log(`  [${i+1}] ${r}`));
  console.log('========================================\n');

  // Don't actually fail — just capture
  expect(pageErrors.length + consoleErrors.length).toBeGreaterThanOrEqual(0);
});
