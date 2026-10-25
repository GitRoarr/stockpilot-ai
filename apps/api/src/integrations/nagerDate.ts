import { fetchJson } from './http.js';

// Nager.Date public holidays (Solution Design §D5.1): v4 endpoint, legacy v3 fallback. No key.
export type Holiday = { date: string; name: string; scope: string };

type V4 = { date: string; name: string; nationalHoliday: boolean; subdivisionCodes: string[] | null; holidayTypes: string[] }[];
type V3 = { date: string; name: string; global: boolean; counties: string[] | null; types: string[] }[];

/** National holidays plus those of the subdivision (e.g. US-CA); observances and other states are ignored (AC-023). */
export function filterHolidays(rows: { date: string; name: string; national: boolean; subdivisions: string[] | null; types: string[] }[], subdivision: string): Holiday[] {
  return rows
    .filter((h) => h.types.includes('Public') && (h.national || (h.subdivisions ?? []).includes(subdivision)))
    .map((h) => ({ date: h.date, name: h.name, scope: h.national ? 'national' : subdivision }));
}

export async function fetchHolidays(country: string, year: number, subdivision: string): Promise<Holiday[]> {
  try {
    const v4 = await fetchJson<V4>(`https://nagerholidays.com/api/v4/Holidays/${country}/${year}`, { timeoutMs: 8000, retries: 1 });
    return filterHolidays(v4.map((h) => ({ date: h.date, name: h.name, national: h.nationalHoliday, subdivisions: h.subdivisionCodes, types: h.holidayTypes ?? [] })), subdivision);
  } catch {
    const v3 = await fetchJson<V3>(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { timeoutMs: 8000, retries: 0 });
    return filterHolidays(v3.map((h) => ({ date: h.date, name: h.name, national: h.global, subdivisions: h.counties, types: h.types ?? [] })), subdivision);
  }
}
