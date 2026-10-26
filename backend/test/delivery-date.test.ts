import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/db/sqlite.js';
import { deliveryDate } from '../src/services/planning.js';
import { addDays, localDate, weekday } from '../src/lib/util.js';
import { setup } from './helpers.js';

// FR-004: a supplier only delivers on its delivery weekdays, so a PO's delivery date moves to the next one.
let app: FastifyInstance;
beforeAll(async () => {
  app = await setup();
});
afterAll(async () => {
  await app.close();
});

const setWeekdays = (csv: string) => db().run(`UPDATE suppliers SET delivery_weekdays = ?, cutoff_time = '23:59' WHERE id = 'sup_gg'`, csv);

describe('delivery date', () => {
  it('lands on a delivery weekday after the lead time', () => {
    const plain = addDays(localDate(), 1);
    // Only the weekday two days after the plain date: the date must move forward to it.
    const only = (weekday(plain) + 2) % 7;
    setWeekdays(String(only));
    const d = deliveryDate('sup_gg', 1);
    expect(weekday(d)).toBe(only);
    expect(d).toBe(addDays(plain, 2));
  });

  it('keeps the lead-time date when the supplier delivers that day', () => {
    setWeekdays('0,1,2,3,4,5,6');
    expect(deliveryDate('sup_gg', 2)).toBe(addDays(localDate(), 2));
  });
});
