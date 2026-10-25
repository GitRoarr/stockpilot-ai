import { fetchJson } from './http.js';

// Open-Meteo forecast + historical archive (Solution Design §D5.1). No key; CC BY 4.0 attribution shown in the UI.
export type WeatherDay = { date: string; tmaxF: number | null; precipIn: number | null; weatherCode: number | null };

type Daily = { daily?: { time: string[]; temperature_2m_max: (number | null)[]; precipitation_sum: (number | null)[]; weather_code?: (number | null)[] } };

function toDays(j: Daily): WeatherDay[] {
  const d = j.daily;
  if (!d || !Array.isArray(d.time)) throw new Error('Open-Meteo: unexpected response');
  return d.time.map((date, i) => ({
    date,
    tmaxF: d.temperature_2m_max[i] ?? null,
    precipIn: d.precipitation_sum[i] ?? null,
    weatherCode: d.weather_code?.[i] ?? null,
  }));
}

export type Location = { latitude: number; longitude: number; timezone: string };

/** 7-day forecast plus `pastDays` of recent history (the archive lags ~5 days). */
export async function fetchForecast(loc: Location, pastDays = 7): Promise<WeatherDay[]> {
  const q = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    daily: 'temperature_2m_max,precipitation_sum,weather_code',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: loc.timezone,
    forecast_days: '7',
    past_days: String(pastDays),
  });
  return toDays(await fetchJson<Daily>(`https://api.open-meteo.com/v1/forecast?${q}`, { timeoutMs: 8000, retries: 1 }));
}

export async function fetchArchive(loc: Location, startDate: string, endDate: string): Promise<WeatherDay[]> {
  const q = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_max,precipitation_sum',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: loc.timezone,
  });
  return toDays(await fetchJson<Daily>(`https://archive-api.open-meteo.com/v1/archive?${q}`, { timeoutMs: 8000, retries: 1 }));
}
