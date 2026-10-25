import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8787),
  // 127.0.0.1 keeps a local install private; hosts such as Render need 0.0.0.0.
  HOST: z.string().default('127.0.0.1'),
  // First start on an empty database (e.g. a fresh cloud instance) loads the starting restaurant data.
  SEED_IF_EMPTY: bool(true),
  DATABASE_PATH: z.string().default(path.join(REPO_ROOT, 'data/stockpilot.db')),
  TZ: z.string().default('America/Los_Angeles'),
  SESSION_SECRET: optional,
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_API_STYLE: z.enum(['interactions', 'generate_content']).default('interactions'),
  GEMINI_MAX_RPM: z.coerce.number().int().positive().default(10),
  GEMINI_DAILY_BUDGET: z.coerce.number().int().positive().default(250),
  GEMINI_THINKING_LEVEL: z.enum(['low', 'medium', 'high', 'default']).default('low'),
  AI_LOG_PAYLOADS: bool(true),
  DEMO_MODE: bool(true),
  BREVO_API_KEY: optional,
  // Verified Brevo sender. EMAIL_FROM / EMAIL_FROM_NAME are the earlier names and still work as fallbacks.
  BREVO_SENDER_EMAIL: optional,
  BREVO_SENDER_NAME: optional,
  EMAIL_FROM: optional,
  EMAIL_FROM_NAME: z.string().default('StockPilot AI'),
  SUPPLIER_EMAIL_OVERRIDE: optional,
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  TELEGRAM_BOT_TOKEN: optional,
  SCHEDULER_ENABLED: bool(true),
  WORKER_ENABLED: bool(true),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = EnvSchema.parse(env);
  if (!path.isAbsolute(cfg.DATABASE_PATH)) cfg.DATABASE_PATH = path.resolve(REPO_ROOT, cfg.DATABASE_PATH);
  return cfg;
}

export let config: Config = loadConfig();

/** Tests override configuration (e.g. in-memory database, no keys). */
export function setConfig(patch: Partial<Config>): Config {
  config = { ...config, ...patch };
  return config;
}

export const RESTAURANT_TZ = () => config.TZ;
