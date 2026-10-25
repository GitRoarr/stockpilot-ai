import { defineConfig } from '@playwright/test';

// Browser E2E of the demo path (SRS §16 "E2E"). Uses the system Chrome; seeds an offline demo database first.
const PORT = 8788;
const env = {
  PORT: String(PORT),
  DATABASE_PATH: './data/e2e.db',
  SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
  NODE_ENV: 'production',
  APP_BASE_URL: `http://127.0.0.1:${PORT}`,
  SCHEDULER_ENABLED: 'false',
  GEMINI_API_KEY: '',
  BREVO_API_KEY: '',
  DEMO_MODE: 'true',
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'chrome', headless: true, screenshot: 'only-on-failure', viewport: { width: 1360, height: 900 } },
  webServer: {
    command: 'npm run seed -w apps/api -- --offline && npm run start -w apps/api',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
