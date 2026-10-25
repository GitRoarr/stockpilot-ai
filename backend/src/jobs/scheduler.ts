import cron from 'node-cron';
import { db } from '../db/sqlite.js';
import { startMorningRun } from '../agents/triggers.js';
import { getSettings } from '../lib/settings.js';
import { addDays, localDate, localTime, weekday } from '../lib/util.js';
import { fitModels, latestModelRun } from '../services/forecast.js';
import { snapshotScorecards } from '../services/scorecards.js';
import { refreshContext } from '../services/context.js';

// Scheduler (Solution Design §D7.3). A node-cron minute tick evaluates the schedule against the demo clock, so missed
// runs are caught up at start-up and demo time travel triggers the same jobs. All runs are idempotent by key.
const NIGHTLY_FIT = '01:30';
const WEEKLY_SCORECARD = { weekday: 1, time: '07:00' };

export function schedulerTick(): string[] {
  const s = getSettings();
  if (!s.onboardingComplete || !db().get(`SELECT 1 FROM agents WHERE id = 'pilot'`)) return [];
  const started: string[] = [];
  const today = localDate();
  const t = localTime();
  if (t >= s.morningRunTime && t < s.workingHours.to && !db().get(`SELECT 1 FROM agent_runs WHERE run_key = ?`, `${today}:morning`)) {
    // A workspace created after today's run time did not "miss" the run.
    const created = db().get<{ value: string }>(`SELECT value FROM settings WHERE key = 'workspace_created'`)?.value ?? '';
    if (created < `${today}T${s.morningRunTime}`) {
      startMorningRun({ trigger: 'schedule' });
      started.push('morning');
    }
  }
  if (t >= NIGHTLY_FIT && latestModelRun()?.historyEnd !== addDays(today, -1)) {
    fitModels();
    started.push('nightly_fit');
  }
  if (weekday(today) === WEEKLY_SCORECARD.weekday && t >= WEEKLY_SCORECARD.time && !db().get(`SELECT 1 FROM scorecard_snapshots WHERE period_end = ?`, today)) {
    snapshotScorecards();
    started.push('scorecard');
  }
  return started;
}

let task: { stop: () => void } | undefined;

export function startScheduler(): void {
  const safeTick = () => {
    try {
      schedulerTick();
    } catch (e) {
      console.error('[scheduler]', (e as Error).message);
    }
  };
  task = cron.schedule('* * * * *', safeTick);
  setTimeout(safeTick, 2000);
  // Keep the weather forecast warm (cache ≤ 3 h).
  cron.schedule('17 */3 * * *', () => void refreshContext().catch(() => {}));
}

export function stopScheduler(): void {
  task?.stop();
}
