// Run: node score.test.js
import assert from 'node:assert/strict';
import { hourlyScores, dailyScores, moonPhase } from './score.js';

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

console.log('score.test.js: all checks passed');
