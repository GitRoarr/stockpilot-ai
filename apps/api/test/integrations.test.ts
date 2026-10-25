import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setConfig } from '../src/config.js';
import { db } from '../src/db/sqlite.js';
import { drainJobs } from '../src/jobs/worker.js';
import { setFetch } from '../src/integrations/http.js';
import { brevoConfigured, sendBrevo } from '../src/integrations/brevo.js';
import { filterHolidays, fetchHolidays } from '../src/integrations/nagerDate.js';
import { fetchForecast } from '../src/integrations/openMeteo.js';
import { fromInteractionSteps, toInteractionSteps } from '../src/agents/llm/interactions.js';
import { toContents } from '../src/agents/llm/generateContent.js';
import { startMorningRun } from '../src/agents/triggers.js';
import { refreshContext } from '../src/services/context.js';
import { approvePo, sendPo } from '../src/services/purchaseOrders.js';
import { validateExtraction } from '../src/services/invoices.js';
import { setup } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  setConfig({ BREVO_API_KEY: undefined, BREVO_SENDER_EMAIL: undefined, BREVO_SENDER_NAME: undefined, EMAIL_FROM: undefined });
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Open-Meteo adapter', () => {
  it('parses the daily forecast (°F, inches)', async () => {
    setFetch((async () => json(200, { daily: { time: ['2026-10-25'], temperature_2m_max: [65.5], precipitation_sum: [0.3], weather_code: [61] } })) as never);
    expect(await fetchForecast({ latitude: 37.77, longitude: -122.42, timezone: 'America/Los_Angeles' })).toEqual([{ date: '2026-10-25', tmaxF: 65.5, precipIn: 0.3, weatherCode: 61 }]);
  });

  it('HTTP 500 with no cache: the morning run completes and weather is reported unavailable (AC-029)', async () => {
    app = await setup({ llm: null });
    setFetch((async () => json(500, { error: true })) as never);
    const st = await refreshContext({ force: true });
    expect(st.weather_forecast.status).toBe('unavailable');
    expect(st.weather_forecast.message).toContain('Weather unavailable — model without weather used');
    const id = startMorningRun({ trigger: 'manual' });
    await drainJobs();
    expect(db().get<{ status: string }>(`SELECT status FROM agent_runs WHERE id = ?`, id)!.status).toBe('completed');
    const dp = db().get<{ final_message: string }>(`SELECT final_message FROM agent_runs WHERE agent_id = 'demand-planner' ORDER BY started_at DESC LIMIT 1`)!;
    expect(dp.final_message).toContain('Weather unavailable — model without weather used');
  });
});

describe('Nager.Date adapter (AC-023)', () => {
  it('keeps national and US-CA public holidays, ignores other states and observances', () => {
    const rows = [
      { date: '2026-07-04', name: 'Independence Day', national: true, subdivisions: null, types: ['Public'] },
      { date: '2026-03-31', name: 'César Chávez Day', national: false, subdivisions: ['US-CA'], types: ['Public'] },
      { date: '2026-04-20', name: "Patriots' Day", national: false, subdivisions: ['US-MA', 'US-ME'], types: ['Public'] },
      { date: '2026-02-12', name: "Lincoln's Birthday", national: false, subdivisions: ['US-CA'], types: ['Observance'] },
    ];
    expect(filterHolidays(rows, 'US-CA').map((h) => h.name)).toEqual(['Independence Day', 'César Chávez Day']);
  });

  it('falls back to the legacy v3 endpoint', async () => {
    const urls: string[] = [];
    setFetch((async (u: string) => {
      urls.push(u);
      return u.includes('v4') ? json(503, {}) : json(200, [{ date: '2026-12-25', name: 'Christmas Day', global: true, counties: null, types: ['Public'] }]);
    }) as never);
    const hs = await fetchHolidays('US', 2026, 'US-CA');
    expect(hs.map((h) => h.name)).toEqual(['Christmas Day']);
    expect(urls.some((u) => u.includes('date.nager.at/api/v3'))).toBe(true);
  });
});

describe('Brevo via the outbox (AC-090)', () => {
  it('401 → outbox failed with the provider message, notification, PO stays approved', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    setConfig({ BREVO_API_KEY: 'bad-key', EMAIL_FROM: 'demo@stockpilot.example' });
    let sent = 0;
    setFetch((async (u: string) => {
      if (u.includes('api.brevo.com')) {
        sent++;
        return json(401, { code: 'unauthorized', message: 'Key not found' });
      }
      throw new Error('offline');
    }) as never);
    const po = db().get<{ id: string }>(`SELECT id FROM purchase_orders WHERE supplier_id = 'sup_gg' AND status = 'pending_approval'`)!;
    approvePo(po.id, { id: 'usr_daniel', role: 'chef' });
    sendPo(po.id, { type: 'user', id: 'usr_daniel' });
    await drainJobs();
    expect(sent).toBe(1);
    const e = db().get<{ status: string; error: string; to_email: string }>(`SELECT status, error, to_email FROM email_messages WHERE kind = 'po' AND related_id = ?`, po.id)!;
    expect(e.status).toBe('failed');
    expect(e.error).toContain('Key not found');
    expect(e.to_email).toBe('demo@stockpilot.example'); // demo redirection (SAF-6)
    expect(db().get<{ status: string }>(`SELECT status FROM purchase_orders WHERE id = ?`, po.id)!.status).toBe('approved');
    expect(db().get(`SELECT 1 FROM notifications WHERE kind = 'email_failed'`)).toBeTruthy();
  });

  it('201 → sent with messageId; PO becomes sent by email', async () => {
    app = await setup({ llm: null });
    startMorningRun({ trigger: 'manual' });
    await drainJobs();
    setConfig({ BREVO_API_KEY: 'key', EMAIL_FROM: 'demo@stockpilot.example' });
    setFetch((async (u: string, init: RequestInit) => {
      if (u.includes('api.brevo.com')) {
        expect((init.headers as Record<string, string>)['api-key']).toBe('key');
        return json(201, { messageId: '<abc@brevo>' });
      }
      throw new Error('offline');
    }) as never);
    const po = db().get<{ id: string }>(`SELECT id FROM purchase_orders WHERE supplier_id = 'sup_gg' AND status = 'pending_approval'`)!;
    approvePo(po.id, { id: 'usr_daniel', role: 'chef' });
    sendPo(po.id, { type: 'user', id: 'usr_daniel' });
    await drainJobs();
    expect(db().get<{ provider_message_id: string }>(`SELECT provider_message_id FROM email_messages WHERE related_id = ?`, po.id)!.provider_message_id).toBe('<abc@brevo>');
    expect(db().get<any>(`SELECT status, send_channel FROM purchase_orders WHERE id = ?`, po.id)).toMatchObject({ status: 'sent', send_channel: 'email' });
  });
});

describe('Brevo sender configuration', () => {
  it('BREVO_SENDER_EMAIL / BREVO_SENDER_NAME are used as the sender and take precedence over EMAIL_FROM', async () => {
    setConfig({ BREVO_API_KEY: 'key', BREVO_SENDER_EMAIL: 'orders@harborvine.example', BREVO_SENDER_NAME: 'Harbor & Vine Purchasing', EMAIL_FROM: 'old@stockpilot.example' });
    let body: any;
    setFetch((async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return json(201, { messageId: '<m1@brevo>' });
    }) as never);
    expect(await sendBrevo({ to: 'chef@harborvine.example', subject: 's', html: '<p>h</p>', text: 't' })).toEqual({ ok: true, messageId: '<m1@brevo>' });
    expect(body.sender).toEqual({ email: 'orders@harborvine.example', name: 'Harbor & Vine Purchasing' });
  });
  it('the earlier EMAIL_FROM still works, and without any sender Brevo reports not configured', async () => {
    setConfig({ BREVO_API_KEY: 'key', BREVO_SENDER_EMAIL: undefined, BREVO_SENDER_NAME: undefined, EMAIL_FROM: 'old@stockpilot.example' });
    expect(brevoConfigured()).toBe(true);
    setConfig({ EMAIL_FROM: undefined });
    expect(brevoConfigured()).toBe(false);
    expect(await sendBrevo({ to: 'x@y.example', subject: 's', html: '', text: '' })).toMatchObject({ ok: false, message: 'not_configured' });
  });
});

describe('Gemini adapters (history mapping, store:false)', () => {
  const history = [
    { role: 'user' as const, text: 'go' },
    { role: 'model' as const, calls: [{ id: 'c1', name: 'get_forecast', args: { days: 7 } }], provider: 'generate_content' as const, raw: undefined },
    { role: 'tool' as const, results: [{ callId: 'c1', name: 'get_forecast', result: { ok: 1 } }] },
  ];
  it('Interactions: user_input, function_call and function_result steps; thought steps are resent', () => {
    const steps = toInteractionSteps(history);
    expect(steps.map((s) => s.type)).toEqual(['user_input', 'function_call', 'function_result']);
    expect(steps[2]).toMatchObject({ call_id: 'c1', name: 'get_forecast', result: '{"ok":1}' });
    const raw = [{ type: 'thought', signature: 'sig' }, { type: 'function_call', id: 'c2', name: 'x', arguments: {} }];
    expect(toInteractionSteps([{ role: 'model', calls: [], provider: 'interactions', raw }])).toEqual(raw);
    const parsed = fromInteractionSteps([{ type: 'thought', signature: 's' }, { type: 'function_call', id: 'f1', name: 'get_team_status', arguments: {} }]);
    expect(parsed.calls).toEqual([{ id: 'f1', name: 'get_team_status', args: {} }]);
    expect((parsed.raw as unknown[]).length).toBe(2);
  });
  it('generateContent: functionCall / functionResponse parts', () => {
    const c = toContents(history);
    expect(c[1].parts[0].functionCall).toMatchObject({ name: 'get_forecast', args: { days: 7 } });
    expect(c[2].parts[0].functionResponse).toMatchObject({ name: 'get_forecast', response: { result: { ok: 1 } } });
  });
});

describe('invoice validation (AC-083)', () => {
  it('flags 40 × $3.25 extracted as $103.00 as math_error and an old date as implausible', () => {
    const issues = validateExtraction({ supplierName: 'GG', invoiceNumber: 'X', date: '2020-01-01', currency: 'USD', lines: [{ description: 'Chicken', qty: 40, unitPrice: 3.25, extended: 103, confidence: 0.9 }], total: 103 }, '2026-10-25');
    expect(issues.find((i) => i.field === 'lines.0.extended')!.message).toContain('math_error');
    expect(issues.some((i) => i.field === 'date')).toBe(true);
  });
});

describe('Gemini tool declarations', () => {
  it('contain no schema keywords the Gemini API rejects (boolean exclusiveMinimum/Maximum, oneOf)', async () => {
    const { declarations } = await import('../src/agents/tools/index.js');
    const { TOOL_NAMES } = await import('../src/agents/manifest.js');
    const json = JSON.stringify(declarations([...TOOL_NAMES]));
    expect(json).not.toMatch(/"exclusive(Minimum|Maximum)":(true|false)/);
    expect(json).not.toContain('"oneOf"');
    expect(json).toContain('"anyOf"'); // the working-agreement union is still expressed
  });
});
