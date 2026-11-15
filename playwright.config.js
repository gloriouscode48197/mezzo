import { defineConfig } from '@playwright/test';

/**
 * Mezzo — Playwright browser-test config.
 *
 * Separate from the main `node --test src/*.test.js` suite (pure-logic
 * unit tests, no browser) — this covers what genuinely needs a real
 * browser: the Mezzo Companion's Document Picture-in-Picture screens,
 * which require a real `documentPictureInPicture` implementation no
 * DOM-emulation library (linkedom, jsdom) provides. Run with:
 *
 *   npx playwright test
 *
 * Chromium only — Document Picture-in-Picture is Chromium-specific (see
 * CLAUDE.md's Non-Negotiable Decisions: "Document Picture-in-Picture
 * support is required to use Mezzo").
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // each test opens/tears down its own PiP window; keep this predictable
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:8973',
    trace: 'retain-on-failure',
  },

  webServer: {
    command: 'node tests/support/static-server.mjs',
    url: 'http://localhost:8973/index.html',
    reuseExistingServer: !process.env.CI,
  },

  projects: [
    {
      name: 'chromium-pip',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // Mixpanel never loads or sends during tests: its hosts don't
            // resolve, so Home's snippet can't fetch the library and no
            // event reaches the real project. Tests that need Mixpanel
            // (tests/privacy-settings.spec.js) serve a saved copy of the
            // library with page.route(), which answers before any lookup.
            '--host-resolver-rules=MAP cdn.mxpnl.com ~NOTFOUND, MAP mixpanel.com ~NOTFOUND, MAP *.mixpanel.com ~NOTFOUND',
          ],
        },
      },
    },
  ],
});
