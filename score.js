// Fishing-conditions score. Pure functions: no DOM, no network.
// Model: GLM-style product of multipliers (see AGENTS.md "Scoring model").

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const SYNODIC_DAYS = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

// Calibration knob. ponytail: thermal optima are generic placeholders,
// replace with per-species values (FishBase) or fit to the user's catch log.
export const MODEL = {
  light: { sigmaMin: 50, gain: 1.0 },              // dawn/dusk bump, up to x2
  temp: {
    sea: { opt: 19, sigma: 5 },                    // °C, sea surface temperature
    fresh: { opt: 18, sigma: 6 },                  // °C, 72 h mean air temp as water proxy
    floor: 0.3,
    shockC: 3,                                     // 24 h change that costs ~40%
  },
  waves: { opt: 0.6, sigma: 0.7, floor: 0.4 },     // m, parabolic optimum
  wind: { calm: 8, scale: 4 },                     // m/s, penalty only above `calm`
  water: { min: 0.8, max: 1.2 },                   // slack water -> fastest flow of the day
  moon: { gain: 0.1 },                             // weak, peaks at new and full moon
  bestHours: 6,
};

const MAX_PRODUCT = (1 + MODEL.light.gain) * MODEL.water.max * (1 + MODEL.moon.gain);

const gauss = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
const ok = (v) => v != null && Number.isFinite(v);

// 0 = new moon, 0.5 = full moon.
export function moonPhase(utcMs) {
  const p = ((utcMs - REF_NEW_MOON) / DAY / SYNODIC_DAYS) % 1;
  return p < 0 ? p + 1 : p;
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

function meanBack(arr, i, n) {
  let sum = 0, cnt = 0;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) if (ok(arr[k])) { sum += arr[k]; cnt++; }
  return cnt ? sum / cnt : null;
}

// d: { time[], utcOffsetMs, airTemp[], wind[], sst[], wave[], seaLevel[], sunrise[], sunset[] }
// time/sunrise/sunset are "local wall clock as UTC" ms, hourly arrays share `time`.
// mode: 'sea' | 'fresh'. Returns [{ t, score, f: { light, temp, waves, wind, water, moon }, waterTemp }].
export function hourlyScores(d, mode) {
  const m = MODEL;
  const sea = mode === 'sea';
  const sunByDay = new Map(d.sunrise.map((sr, i) => [dayKey(sr), [sr, d.sunset[i]]]));
  const airProxy = d.time.map((_, i) => meanBack(d.airTemp, i, 72));
  const flow = d.time.map((_, i) => {
    const a = d.seaLevel?.[i - 1], b = d.seaLevel?.[i + 1];
    return ok(a) && ok(b) ? Math.abs(b - a) / 2 : null;
  });
  const maxFlow = new Map();
  d.time.forEach((t, i) => {
    if (ok(flow[i])) maxFlow.set(dayKey(t), Math.max(maxFlow.get(dayKey(t)) ?? 0, flow[i]));
  });

  return d.time.map((t, i) => {
    const f = { light: 1, temp: 1, waves: 1, wind: 1, water: 1, moon: 1 };

    const sun = sunByDay.get(dayKey(t));
    if (sun) {
      const s = m.light.sigmaMin * 60e3;
      f.light = 1 + m.light.gain * Math.max(gauss(t, sun[0], s), gauss(t, sun[1], s));
    }

    const useSst = sea && ok(d.sst?.[i]);
    const series = useSst ? d.sst : airProxy;
    const water = series[i];
    if (ok(water)) {
      const { opt, sigma } = useSst ? m.temp.sea : m.temp.fresh;
      const fit = gauss(water, opt, sigma);
      const prev = series[i - 24];
      const shock = ok(prev) ? gauss(water - prev, 0, m.temp.shockC) : 1;
      f.temp = m.temp.floor + (1 - m.temp.floor) * fit * shock;
    }

    if (sea && ok(d.wave?.[i])) {
      f.waves = m.waves.floor + (1 - m.waves.floor) * gauss(d.wave[i], m.waves.opt, m.waves.sigma);
    }

    if (ok(d.wind[i]) && d.wind[i] > m.wind.calm) {
      f.wind = 1 / (1 + ((d.wind[i] - m.wind.calm) / m.wind.scale) ** 2);
    }

    const top = maxFlow.get(dayKey(t));
    if (sea && ok(flow[i]) && top > 0) {
      f.water = m.water.min + (m.water.max - m.water.min) * (flow[i] / top);
    }

    f.moon = 1 + m.moon.gain * Math.cos(4 * Math.PI * moonPhase(t - d.utcOffsetMs));

    const product = Object.values(f).reduce((a, b) => a * b, 1);
    const score = Math.round(Math.min(100, Math.max(0, (100 * product) / MAX_PRODUCT)));
    return { t, score, f, waterTemp: ok(water) ? water : null };
  });
}

// Groups hours by local date. Day score = mean of the best `bestHours` hours.
export function dailyScores(hours) {
  const days = new Map();
  for (const h of hours) {
    const k = dayKey(h.t);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(h);
  }
  return [...days].map(([day, hs]) => {
    const best = hs.map((h) => h.score).sort((a, b) => b - a).slice(0, MODEL.bestHours);
    return { day, score: Math.round(best.reduce((a, b) => a + b, 0) / best.length), hours: hs };
  });
}

export const label = (s) => (s < 35 ? 'Низька' : s < 60 ? 'Середня' : s < 80 ? 'Висока' : 'Дуже висока');
export const stars = (s) => 1 + (s >= 35) + (s >= 60) + (s >= 80);
