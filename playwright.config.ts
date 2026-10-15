import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5174', channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'darwin' ? 'chrome' : undefined), headless: true, trace: 'retain-on-failure' },
  webServer: [{
    command: 'npm run dev:client -- --port 5174',
    url: 'http://127.0.0.1:5174',
    env: { VITE_GOOGLE_MAPS_API_KEY: 'ui-test-key' },
    reuseExistingServer: false,
  }, {
    command: 'npm run dev:client -- --port 5175',
    url: 'http://127.0.0.1:5175',
    env: { VITE_GOOGLE_MAPS_API_KEY: '' },
    reuseExistingServer: false,
  }],
});
