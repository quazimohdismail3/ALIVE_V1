import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  readFileSync(resolve('.env.test'), 'utf8')
    .split('\n')
    .forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    });
} catch {}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
  reporter: 'html',
  globalSetup: './e2e/global-setup.js',

  use: {
    baseURL: 'https://mission-alive.vercel.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
