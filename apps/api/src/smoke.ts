// Live smoke checks (SRS §16, Solution Design §D10.1): Open-Meteo forecast + archive, Nager.Date, Gemini models.get for
// both models + one small generation, Brevo key check. Checks without a key are reported as skipped, not passed.
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { checkBrevo } from './integrations/brevo.js';
import { fetchHolidays } from './integrations/nagerDate.js';
import { fetchArchive, fetchForecast } from './integrations/openMeteo.js';

const loc = { latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

type Check = { name: string; needs?: string; run: () => Promise<string> };

const checks: Check[] = [
  { name: 'Open-Meteo forecast', run: async () => `${(await fetchForecast(loc, 0)).length} days` },
  { name: 'Open-Meteo historical', run: async () => `${(await fetchArchive(loc, day(-14), day(-8))).length} days` },
  { name: 'Nager.Date holidays (US + US-CA)', run: async () => `${(await fetchHolidays('US', new Date().getFullYear(), 'US-CA')).length} holidays` },
  {
    name: 'Gemini models.get',
    needs: 'GEMINI_API_KEY',
    run: async () => {
      const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY! });
      const names = [];
      for (const model of [config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL]) names.push((await ai.models.get({ model })).name ?? model);
      return names.join(', ');
    },
  },
  {
    name: `Gemini generation (${config.GEMINI_API_STYLE})`,
    needs: 'GEMINI_API_KEY',
    run: async () => {
      const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY! });
      if (config.GEMINI_API_STYLE === 'interactions') {
        const r: any = await (ai.interactions as any).create({ model: config.GEMINI_MODEL, input: 'Reply with the single word OK.', store: false });
        return `"${String(r.output_text ?? '').trim().slice(0, 20)}"`;
      }
      const r = await ai.models.generateContent({ model: config.GEMINI_MODEL, contents: 'Reply with the single word OK.' });
      return `"${(r.text ?? '').trim().slice(0, 20)}"`;
    },
  },
  { name: 'Brevo API key', needs: 'BREVO_API_KEY', run: async () => checkBrevo() },
];

let failed = 0;
for (const c of checks) {
  if (c.needs && !(config as Record<string, unknown>)[c.needs]) {
    console.log(`- ${c.name}: skipped (${c.needs} not set)`);
    continue;
  }
  try {
    const r = await c.run();
    if (r.startsWith('HTTP')) throw new Error(r);
    console.log(`✓ ${c.name}: ${r}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${c.name}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
