import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.test for TEST_USER_EMAIL / TEST_USER_PASSWORD
try {
  readFileSync(resolve('.env.test'), 'utf8')
    .split('\n')
    .forEach(line => {
      const eq = line.indexOf('=')
      if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    })
} catch {}

export default defineConfig({
  testDir: './e2e',
  testMatch: /v2-smoke\.spec\.js/,
  timeout: 30000,
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: 'https://mission-alive.vercel.app',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
