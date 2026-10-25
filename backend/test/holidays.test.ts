import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildFacts, ruleBasedBriefing, validateBriefing } from '../src/agents/briefing.js';
import { db } from '../src/db/sqlite.js';
import { addDays, localDate, nowIso } from '../src/lib/util.js';
import { setup } from './helpers.js';

// Holidays in the coming week reach the standup (both modes), so the team can order ahead of supplier lead times.
let app: FastifyInstance;
beforeAll(async () => {
  app = await setup({ llm: null });
});
afterAll(async () => app.close());

describe('upcoming holidays in the standup', () => {
  it('names a holiday later this week, with its date, in the Demand Planner items; grounding accepts it', () => {
    const date = addDays(localDate(), 3);
    db().run(`INSERT OR REPLACE INTO holidays (date, name, scope) VALUES (?, 'Test Holiday', 'US')`, date);
    const facts = buildFacts(nowIso());
    expect(facts.upcomingHolidays).toContainEqual({ date, name: 'Test Holiday' });
    const b = ruleBasedBriefing(facts);
    const dp = b.agents.find((a) => a.agentId === 'demand-planner')!;
    expect(dp.today.map((t) => t.text).join(' | ')).toContain(`Test Holiday on ${date}`);
    expect(validateBriefing(b, facts).ok).toBe(true);
  });

  it('ignores holidays more than a week away', () => {
    db().run(`INSERT OR REPLACE INTO holidays (date, name, scope) VALUES (?, 'Far Holiday', 'US')`, addDays(localDate(), 20));
    expect(buildFacts(nowIso()).upcomingHolidays.map((h) => h.name)).not.toContain('Far Holiday');
  });
});
