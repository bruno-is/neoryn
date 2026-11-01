import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4174',
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'msedge',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.CI ? [
    { command: 'npm run dev -- --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: false, env: { VITE_GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', VITE_GOOGLE_API_KEY: 'test-picker-key', VITE_GOOGLE_APP_ID: '123456' } },
    ...(process.env.NEORYN_PRODUCTION_TEST ? [{ command: 'npm run preview:pages', url: 'http://127.0.0.1:4175/neoryn/', reuseExistingServer: false }] : []),
  ] : undefined,
})
