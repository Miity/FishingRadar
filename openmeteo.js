// Open-Meteo client: hourly arrays in the shape score.js expects. Shared by app.js and add-dive.mjs.
export const api = (host, path, params) => `https://${host}/v1/${path}?${new URLSearchParams(params)}`;
export const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const ms = (s) => Date.parse(s + 'Z'); // local wall clock as UTC

// range: { past_days, forecast_days } or { start_date, end_date }.
export async function fetchConditions(place, range, marine = true) {
  const common = { latitude: place.lat, longitude: place.lon, timezone: 'auto', ...range };
  const [fc, sea] = await Promise.all([
    getJson(api('api.open-meteo.com', 'forecast', { ...common, hourly: 'temperature_2m,wind_speed_10m', daily: 'sunrise,sunset', wind_speed_unit: 'ms' })),
    marine
      ? getJson(api('marine-api.open-meteo.com', 'marine', { ...common, hourly: 'sea_surface_temperature,wave_height,wave_period,sea_level_height_msl,ocean_current_velocity' })).catch(() => null)
      : null,
  ]);
  const idx = new Map((sea?.hourly?.time ?? []).map((s, i) => [s, i]));
  const fromMarine = (k) => fc.hourly.time.map((s) => sea?.hourly?.[k]?.[idx.get(s)] ?? null);
  return {
    time: fc.hourly.time.map(ms),
    utcOffsetMs: fc.utc_offset_seconds * 1000,
    airTemp: fc.hourly.temperature_2m,
    wind: fc.hourly.wind_speed_10m,
    sst: fromMarine('sea_surface_temperature'),
    wave: fromMarine('wave_height'),
    period: fromMarine('wave_period'),
    seaLevel: fromMarine('sea_level_height_msl'),
    current: fromMarine('ocean_current_velocity').map((v) => (v == null ? null : v / 3.6)), // km/h -> m/s
    sunrise: fc.daily.sunrise.map(ms),
    sunset: fc.daily.sunset.map(ms),
  };
}
