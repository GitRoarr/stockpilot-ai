import { z } from 'zod';
import { db } from '../db/sqlite.js';
import { json } from './util.js';

// Owner-editable settings (SRS FR-101). Stored as one JSON document; defaults = Solution Design values.
export const SettingsSchema = z.object({
  restaurantName: z.string().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: z.string().regex(/^[A-Z]{2}$/),
  subdivision: z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/),
  timezone: z.string().min(3),
  currency: z.literal('USD'),
  weatherEnabled: z.boolean(),
  holidaysEnabled: z.boolean(),
  expiryWindowDays: z.number().int().min(1).max(14),
  defaultServiceLevel: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.98)]),
  priceTolerancePct: z.number().min(0).max(0.2),
  priceToleranceAbs: z.number().min(0).max(5),
  substitutionTolerancePct: z.number().min(0).max(0.2),
  disputeMinimum: z.number().min(0),
  chefApprovalLimit: z.number().min(0),
  autoSend: z.object({ enabled: z.boolean(), maxTotal: z.number().min(0), maxDeviationPct: z.number().min(0).max(100) }),
  morningRunTime: z.string().regex(/^\d{2}:\d{2}$/),
  workingHours: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }),
  confirmationHours: z.number().min(1).max(48),
  questionTimeoutHours: z.number().min(0.25).max(24),
  briefingEmail: z.boolean(),
  onboardingComplete: z.boolean(),
  demoData: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  restaurantName: 'Harbor & Vine Bistro',
  latitude: 37.7749,
  longitude: -122.4194,
  country: 'US',
  subdivision: 'US-CA',
  timezone: 'America/Los_Angeles',
  currency: 'USD',
  weatherEnabled: true,
  holidaysEnabled: true,
  expiryWindowDays: 3,
  defaultServiceLevel: 0.95,
  priceTolerancePct: 0.02,
  priceToleranceAbs: 0.02,
  substitutionTolerancePct: 0.05,
  disputeMinimum: 5,
  chefApprovalLimit: 1500,
  autoSend: { enabled: false, maxTotal: 500, maxDeviationPct: 20 },
  morningRunTime: '06:00',
  workingHours: { from: '06:00', to: '22:00' },
  confirmationHours: 4,
  questionTimeoutHours: 2,
  briefingEmail: true,
  onboardingComplete: false,
  demoData: false,
};

export function getSettings(): Settings {
  const row = db().get<{ value: string }>(`SELECT value FROM settings WHERE key = 'app'`);
  return { ...DEFAULT_SETTINGS, ...json<Partial<Settings>>(row?.value, {}) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = SettingsSchema.parse({ ...getSettings(), ...patch });
  db().run(`INSERT INTO settings(key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(next));
  return next;
}
