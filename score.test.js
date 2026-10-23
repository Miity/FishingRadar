// Run: node score.test.js
import assert from 'node:assert/strict';
import { hourlyScores, dailyScores, moonPhase, bottomVelocity } from './score.js';

const HOUR = 3600e3;
const start = Date.UTC(2026, 9, 20); // local midnight, "local as UTC"
const n = 4 * 24;
const time = Array.from({ length: n }, (_, i) => start + i * HOUR);
const days = [0, 1, 2, 3].map((k) => start + k * 24 * HOUR);

const base = (over = {}) => ({
  time,
  utcOffsetMs: 2 * HOUR,
  airTemp: time.map(() => 18),
  wind: time.map(() => 3),
  sst: time.map(() => 19),
  wave: time.map(() => 0.6),
  seaLevel: time.map((t) => 0.15 * Math.sin((2 * Math.PI * (t - start)) / (12.42 * HOUR))),
  sunrise: days.map((d) => d + 6.5 * HOUR),
  sunset: days.map((d) => d + 17.5 * HOUR),
  ...over,
});

// Moon phase: reference new moon and a known full moon (2024-01-25 17:54 UTC).
assert.ok(moonPhase(Date.UTC(2000, 0, 6, 18, 14)) < 0.01);
assert.ok(Math.abs(moonPhase(Date.UTC(2024, 0, 25, 17, 54)) - 0.5) < 0.03);

// Dusk beats midday on the same day, whatever the tide does.
const calm = hourlyScores(base(), 'sea');
const at = (hs, day, hour) => hs.find((h) => h.t === start + (day * 24 + hour) * HOUR);
assert.ok(at(calm, 1, 18).score > at(calm, 1, 12).score);

// Scores stay in range; all factors positive.
for (const h of calm) {
  assert.ok(h.score >= 0 && h.score <= 100);
  for (const v of Object.values(h.f)) assert.ok(v > 0);
}

// Storm (3 m waves, 15 m/s wind) is worse than calm for every day.
const storm = dailyScores(hourlyScores(base({ wave: time.map(() => 3), wind: time.map(() => 15) }), 'sea'));
dailyScores(calm).forEach((d, i) => assert.ok(storm[i].score < d.score));

// Slack water (tide turning) scores lower on the water factor than mid-tide flow.
const flows = calm.slice(24, 48).map((h) => h.f.water);
assert.ok(Math.min(...flows) < 0.9 && Math.max(...flows) > 1.15);

// Freshwater / inland: no marine data -> neutral marine factors, air proxy for temperature.
const fresh = hourlyScores(base({ sst: time.map(() => null), wave: time.map(() => null), seaLevel: null }), 'fresh');
for (const h of fresh) {
  assert.equal(h.f.waves, 1);
  assert.equal(h.f.water, 1);
  assert.equal(h.waterTemp, 18);
}

// Temperature shock: a 6 °C drop over 24 h hurts.
const shock = hourlyScores(base({ sst: time.map((t) => (t < start + 48 * HOUR ? 25 : 19)) }), 'sea');
assert.ok(at(shock, 2, 12).f.temp < at(calm, 2, 12).f.temp);

// Daily grouping.
const daily = dailyScores(calm);
assert.equal(daily.length, 4);
assert.equal(daily[0].hours.length, 24);

// --- Spearfishing mode ---

// Near-bottom orbital velocity at 5 m: chop barely stirs, long pre-storm swell does.
assert.ok(Math.abs(bottomVelocity(0.5, 3, 5) - 0.11) < 0.01);
assert.ok(Math.abs(bottomVelocity(0.6, 10, 5) - 0.40) < 0.01);
assert.ok(Math.abs(bottomVelocity(2, 7, 5) - 1.27) < 0.01);

// Waves/periods per hour from a function of the hour index.
const sea = (fn) => {
  const w = time.map((_, i) => fn(i));
  return base({ wave: w.map((x) => x[0]), period: w.map((x) => x[1]) });
};
const spear = (fn) => hourlyScores(sea(fn), 'spear');
const plain = spear(() => [0.5, 4]);
const afterStorm = spear((i) => (i >= 24 && i < 48 ? [2, 7] : [0.5, 4])); // storm on day 1

// Night is closed by law.
assert.equal(at(plain, 1, 2).score, 0);
assert.equal(at(plain, 1, 22).score, 0);

// During the storm: unsafe, near zero.
assert.ok(at(afterStorm, 1, 10).score < 10);

// First calm morning after the storm beats the same morning without one; day 2 has cleared.
assert.ok(at(afterStorm, 2, 8).score > at(plain, 2, 8).score + 15);
assert.ok(at(afterStorm, 3, 8).score < at(afterStorm, 2, 8).score);

// Pre-storm long swell (same height, longer period) already stirs the bottom.
const swell = spear((i) => (i >= 24 && i < 36 ? [0.8, 10] : [0.3, 4]));
const chop = spear((i) => (i >= 24 && i < 36 ? [0.8, 4] : [0.3, 4]));
assert.ok(at(swell, 1, 11).f.turbidity > at(chop, 1, 11).f.turbidity + 0.1);
assert.ok(at(swell, 1, 11).score > at(chop, 1, 11).score);

// A little wave is better than flat calm.
assert.ok(at(plain, 1, 9).score > at(spear(() => [0, 4]), 1, 9).score);

// Rising waves are flagged.
const rising = spear((i) => [i < 33 ? 0.3 : 0.9, 6]);
assert.ok(at(rising, 1, 8).rise >= 0.4);

// Spear day score uses the best 3 hours.
assert.equal(dailyScores(plain, 3)[1].score, Math.round(
  plain.slice(24, 48).map((h) => h.score).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b) / 3));

console.log('score.test.js: all checks passed');
