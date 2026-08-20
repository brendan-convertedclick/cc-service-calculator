// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5174";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: "html",
  use: {
    // 5174 is the team default, but it is not reserved: another project on
    // this machine can be holding it, and reuseExistingServer below will then
    // point the whole suite at that app and "pass" against the wrong one
    // (observed 2026-08-20 — 5174 was serving a different repo). Override with
    // PLAYWRIGHT_BASE_URL when Conductor's dev server is on another port.
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
