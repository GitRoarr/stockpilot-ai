import { claimJobs, completeJob, failJob, onEnqueue, type Job } from './queue.js';

// In-process worker (Solution Design §D7.2). Polls every second and wakes immediately on enqueue.
export class RetryableError extends Error {}
export class PermanentError extends Error {}

type Handler = (payload: any, job: Job) => Promise<void> | void;
const handlers = new Map<string, Handler>();

export function registerJob(type: string, fn: Handler): void {
  handlers.set(type, fn);
}

let running = 0;
const CONCURRENCY = 4;
let timer: NodeJS.Timeout | undefined;
let stopped = true;
const inflight = new Set<Promise<void>>();

async function runJob(job: Job): Promise<void> {
  const h = handlers.get(job.type);
  if (!h) return failJob(job, `no handler for ${job.type}`, false);
  try {
    await h(job.payload, job);
    completeJob(job.id);
  } catch (e) {
    const msg = (e as Error).stack ?? String(e);
    failJob(job, msg, !(e instanceof PermanentError));
    if (process.env.NODE_ENV !== 'test') console.error(`[job ${job.type}] ${(e as Error).message}`);
  }
}

function tick(): void {
  if (stopped) return;
  const free = CONCURRENCY - running;
  if (free <= 0) return;
  for (const job of claimJobs(free)) {
    running++;
    const p = runJob(job).finally(() => {
      running--;
      inflight.delete(p);
      tick();
    });
    inflight.add(p);
  }
}

export function startWorker(): void {
  stopped = false;
  onEnqueue(() => tick());
  timer = setInterval(tick, 1000);
  tick();
}

export async function stopWorker(): Promise<void> {
  stopped = true;
  if (timer) clearInterval(timer);
  await Promise.allSettled([...inflight]);
}

/** Runs due jobs until none are left (tests, demo time travel). Jobs scheduled in the future are not run. */
export async function drainJobs(maxRounds = 200): Promise<number> {
  let n = 0;
  for (let i = 0; i < maxRounds; i++) {
    const jobs = claimJobs(10);
    if (!jobs.length) break;
    for (const j of jobs) {
      await runJob(j);
      n++;
    }
  }
  return n;
}
