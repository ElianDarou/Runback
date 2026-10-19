/* eslint-env node */
const { defineConfig } = require('@playwright/test');
const { existsSync } = require('node:fs');
/** @type {import('@playwright/test').PlaywrightTestConfig<import('@appetize/playwright').AppetizeTestOptions>} */

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/appetize',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'https://appetize.io',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      ...(process.env.HTTPS_PROXY
        ? { proxy: { server: process.env.HTTPS_PROXY } }
        : {}),
    },
    config: {
      buildId: process.env.APPETIZE_BUILD_ID || 'b_zlgisqqvf23g5uuzxijolpzj7q',
      device: 'pixel7',
      language: 'en',
      locale: 'en_US',
      timezone: 'Europe/Berlin',
    },
  },
});
