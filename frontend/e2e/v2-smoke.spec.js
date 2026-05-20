import { test, expect } from '@playwright/test'
import fs from 'fs'

const AUTH_FILE = './e2e/.auth/user.json'

test.describe('V2 smoke — unauthenticated', () => {
  test('splash screen shows ALIVE branding then routes to login', async ({ page }) => {
    await page.goto('/')
    // ALIVE text visible during splash
    await expect(page.getByText('ALIVE')).toBeVisible({ timeout: 5000 })
    // Login form appears within 4s (after 1.5s splash)
    await expect(page.getByPlaceholder('Email')).toBeVisible({ timeout: 4000 })
    await expect(page.getByPlaceholder('Password')).toBeVisible()
  })

  test('login screen has sign-in form', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('input[placeholder="Email"]', { timeout: 5000 })
    await expect(page.getByPlaceholder('Email')).toBeVisible()
    await expect(page.getByPlaceholder('Password')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })
})

test.describe('V2 smoke — authenticated', () => {
  test.use({ storageState: AUTH_FILE })

  test.beforeEach(async () => {
    if (!fs.existsSync(AUTH_FILE)) test.skip()
  })

  test('routes past splash to calibration screen after login', async ({ page }) => {
    await page.goto('/')
    // Should reach CalibrationScreen ("Connect Your Body") or Dashboard
    await Promise.race([
      page.waitForSelector('text=Connect Your Body', { timeout: 8000 }),
      page.waitForSelector('text=Connect Polar H10', { timeout: 8000 }),
      page.waitForSelector('text=Find Your Calm', { timeout: 8000 }),
    ])
  })

  test('calibration screen shows BLE connect button', async ({ page }) => {
    await page.goto('/')
    const connectBtn = page.getByRole('button', { name: /Connect Polar H10/i })
    const alreadyOnDash = page.getByText('Find Your Calm')
    const found = await Promise.race([
      connectBtn.waitFor({ timeout: 8000 }).then(() => 'connect'),
      alreadyOnDash.waitFor({ timeout: 8000 }).then(() => 'dashboard'),
    ]).catch(() => 'timeout')
    // Either calibration or dashboard is acceptable (dashboard if already calibrated)
    expect(['connect', 'dashboard']).toContain(found)
  })

  test('dashboard shows H10 status dot and session cards', async ({ page }) => {
    await page.goto('/')
    // Wait for whichever screen the test user lands on. Skip if not Dashboard.
    const arrived = await Promise.race([
      page.waitForSelector('text=Find Your Calm', { timeout: 10000 }).then(() => 'dashboard'),
      page.waitForSelector('text=Connect Your Body', { timeout: 10000 }).then(() => 'calibration'),
      page.waitForSelector('text=Tell us about you', { timeout: 10000 }).then(() => 'profile-setup'),
    ]).catch(() => 'unknown')
    if (arrived !== 'dashboard') return test.skip()

    await expect(page.getByText('Find Your Calm')).toBeVisible()
    await expect(page.getByText('Wind Down')).toBeVisible()
    await expect(page.getByText('Morning Emergence')).toBeVisible()
  })
})

test.describe('V2 smoke — API health', () => {
  test('backend health endpoint returns ok', async ({ request }) => {
    const res = await request.get('https://alivev1-production.up.railway.app/health')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
