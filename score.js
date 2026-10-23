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
    sea: { opt: 19, sigma: 7 },                    // °C, sea surface temperature
    fresh: { opt: 18, sigma: 6 },                  // °C, 72 h mean air temp as water proxy
    floor: 0.3,
    shockC: 3,                                     // 24 h change that costs ~40%
  },
  waves: { opt: 0.6, sigma: 0.7, floor: 0.4 },     // m, parabolic optimum
  wind: { calm: 8, scale: 4 },                     // m/s, penalty only above `calm`
  water: { min: 0.8, max: 1.2 },                   // slack water -> fastest flow of the day
  moon: { gain: 0.1 },                             // weak, peaks at new and full moon
  bestHours: 6,

  // Spearfishing (shore entry, daylight only by Italian law).
  // ponytail: thresholds fitted to the user's field notes, not measured; calibrate with a dive log.
  spear: {
    depth: 5,                                      // m, where bottom stirring is evaluated
    stirThreshold: 0.2,                            // m/s near-bottom orbital velocity lifting fine sand
    decayH: 12,                                    // h, turbidity settling time
    memoryScale: 5,                                // (m/s)·h of excess stirring for ~63% of the bonus
    gain: 0.8,                                     // turbid-water bonus, up to x1.8
    defaultPeriod: 6,                              // s, when wave_period is missing
    waves: { opt: 0.5, sigmaLow: 0.35, calmFloor: 0.7, cutoff: 0.9, steep: 0.1 }, // m
    wind: { mid: 7, steep: 1 },                    // m/s, logistic safety cut
    morning: { afterSunriseMin: 90, sigmaMin: 90, gain: 0.6 },
    weekend: 0.9,                                  // more people in the water
    riseWarn: 0.4,                                 // m of wave growth within 3 h -> warning
    bestHours: 3,
  },
};

const MAX_PRODUCT = (1 + MODEL.light.gain) * MODEL.water.max * (1 + MODEL.moon.gain);
const MAX_SPEAR = (1 + MODEL.spear.morning.gain) * (1 + MODEL.spear.gain);

const gauss = (x, mu, sigma) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
const logistic = (x, mid, steep) => 1 / (1 + Math.exp((x - mid) / steep));
const ok = (v) => v != null && Number.isFinite(v);

// 0 = new moon, 0.5 = full moon.
export function moonPhase(utcMs) {
  const p = ((utcMs - REF_NEW_MOON) / DAY / SYNODIC_DAYS) % 1;
  return p < 0 ? p + 1 : p;
}

// Linear-wave near-bottom orbital velocity (m/s); Eckart's approximation for k.
export function bottomVelocity(H, T, h) {
  const x = ((2 * Math.PI) / T) ** 2 * h / 9.81;
  const kh = x / Math.sqrt(Math.tanh(x));
  return (Math.PI * H) / (T * Math.sinh(kh));
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

function meanBack(arr, i, n) {
  let sum = 0, cnt = 0;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) if (ok(arr[k])) { sum += arr[k]; cnt++; }
  return cnt ? sum / cnt : null;
}

// Turbidity memory: exponentially decayed sum of excess bottom stirring (hourly series).
function turbidityMemory(d) {
  const s = MODEL.spear;
  const keep = Math.exp(-1 / s.decayH);
  let m = 0;
  return d.time.map((_, i) => {
    const H = d.wave?.[i];
    const T = ok(d.period?.[i]) && d.period[i] > 0 ? d.period[i] : s.defaultPeriod;
    const ub = ok(H) ? bottomVelocity(H, T, s.depth) : null;
    m = m * keep + (ok(ub) ? Math.max(0, ub - s.stirThreshold) : 0);
    return { m, ub };
  });
}

// d: { time[], utcOffsetMs, airTemp[], wind[], sst[], wave[], period[], seaLevel[], sunrise[], sunset[] }
// time/sunrise/sunset are "local wall clock as UTC" ms, hourly arrays share `time`.
// mode: 'sea' | 'fresh' | 'spear'. Returns [{ t, score, f, waterTemp, ... }].
export function hourlyScores(d, mode) {
  const m = MODEL;
  const marine = mode !== 'fresh';
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
  const turb = mode === 'spear' ? turbidityMemory(d) : null;

  return d.time.map((t, i) => {
    const sun = sunByDay.get(dayKey(t));

    const useSst = marine && ok(d.sst?.[i]);
    const series = useSst ? d.sst : airProxy;
    const water = series[i];
    let temp = 1;
    if (ok(water)) {
      const { opt, sigma } = useSst ? m.temp.sea : m.temp.fresh;
      const prev = series[i - 24];
      const shock = ok(prev) ? gauss(water - prev, 0, m.temp.shockC) : 1;
      temp = m.temp.floor + (1 - m.temp.floor) * gauss(water, opt, sigma) * shock;
    }
    const waterTemp = ok(water) ? water : null;

    if (mode === 'spear') {
      const s = m.spear;
      const H = d.wave?.[i], later = d.wave?.[i + 3];
      const rise = ok(H) && ok(later) ? later - H : null;
      const f = { light: 1, temp, waves: 1, wind: 1, turbidity: 1, weekend: 1 };
      if (sun) f.light = 1 + s.morning.gain * gauss(t, sun[0] + s.morning.afterSunriseMin * 60e3, s.morning.sigmaMin * 60e3);
      if (ok(H)) {
        const w = s.waves;
        const low = H < w.opt ? w.calmFloor + (1 - w.calmFloor) * gauss(H, w.opt, w.sigmaLow) : 1;
        f.waves = low * logistic(H, w.cutoff, w.steep);
      }
      if (ok(d.wind[i])) f.wind = logistic(d.wind[i], s.wind.mid, s.wind.steep);
      f.turbidity = 1 + s.gain * (1 - Math.exp(-turb[i].m / s.memoryScale));
      if ([0, 6].includes(new Date(t).getUTCDay())) f.weekend = s.weekend;
      const night = sun && (t < sun[0] || t > sun[1]);
      const product = Object.values(f).reduce((a, b) => a * b, 1);
      const score = night ? 0 : Math.round(Math.min(100, (100 * product) / MAX_SPEAR));
      return { t, score, f, waterTemp, night: !!night, ub: turb[i].ub, rise };
    }

    const f = { light: 1, temp, waves: 1, wind: 1, water: 1, moon: 1 };
    if (sun) {
      const s = m.light.sigmaMin * 60e3;
      f.light = 1 + m.light.gain * Math.max(gauss(t, sun[0], s), gauss(t, sun[1], s));
    }
    if (marine && ok(d.wave?.[i])) {
      f.waves = m.waves.floor + (1 - m.waves.floor) * gauss(d.wave[i], m.waves.opt, m.waves.sigma);
    }
    if (ok(d.wind[i]) && d.wind[i] > m.wind.calm) {
      f.wind = 1 / (1 + ((d.wind[i] - m.wind.calm) / m.wind.scale) ** 2);
    }
    const top = maxFlow.get(dayKey(t));
    if (marine && ok(flow[i]) && top > 0) {
      f.water = m.water.min + (m.water.max - m.water.min) * (flow[i] / top);
    }
    f.moon = 1 + m.moon.gain * Math.cos(4 * Math.PI * moonPhase(t - d.utcOffsetMs));

    const product = Object.values(f).reduce((a, b) => a * b, 1);
    const score = Math.round(Math.min(100, Math.max(0, (100 * product) / MAX_PRODUCT)));
    return { t, score, f, waterTemp };
  });
}

// Groups hours by local date. Day score = mean of the best `best` hours.
export function dailyScores(hours, best = MODEL.bestHours) {
  const days = new Map();
  for (const h of hours) {
    const k = dayKey(h.t);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(h);
  }
  return [...days].map(([day, hs]) => {
    const top = hs.map((h) => h.score).sort((a, b) => b - a).slice(0, best);
    return { day, score: Math.round(top.reduce((a, b) => a + b, 0) / top.length), hours: hs };
  });
}

export const label = (s) => (s < 35 ? 'Низька' : s < 60 ? 'Середня' : s < 80 ? 'Висока' : 'Дуже висока');
export const stars = (s) => 1 + (s >= 35) + (s >= 60) + (s >= 80);
