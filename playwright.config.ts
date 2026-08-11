import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke-test config.
 *
 * Deliberately minimal — one browser (Chromium), one project, no
 * cross-browser matrix. This suite exists to catch "the app doesn't
 * boot" / "the golden path is broken" regressions, not to be a
 * cross-browser compatibility suite. Add more projects/browsers only if
 * a real cross-browser bug shows up.
 *
 * Requires the dev server AND the local Supabase stack to already be
 * running (`npx supabase start` + `npm run dev`) — unlike a typical
 * Playwright setup, there's no `webServer` block auto-starting `next
 * dev` here, because Supabase can't be auto-started the same way and a
 * half-started stack would produce confusing failures. See
 * e2e/README.md for the run steps.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
