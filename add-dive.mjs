// Appends a dive to dives.json with the raw Open-Meteo hours around it, so any future model can re-score it.
// Run: node add-dive.mjs <YYYY-MM-DD> <HH:MM from> <HH:MM to> <lat> <lon> <place name> <rating 1-5> [note]
// ponytail: the forecast API keeps ~3 months of past data; log dives soon after, or switch to historical-forecast-api.
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchConditions } from './openmeteo.js';

const [date, from, to, lat, lon, name, rating, note = ''] = process.argv.slice(2);
const hm = /^\d{2}:\d{2}$/;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !hm.test(from) || !hm.test(to) || from >= to
  || !Number.isFinite(+lat) || !Number.isFinite(+lon) || !name || !(+rating >= 1 && +rating <= 5)) {
  console.error('Usage: node add-dive.mjs 2026-10-11 16:00 18:30 41.249 13.497 "Sant\'Agostino" 5 "note"');
  process.exit(1);
}

// 3 days before for turbidity/temperature lag, 1 day after for the pre-storm look-ahead.
const shift = (days) => new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10);
const place = { name, lat: +lat, lon: +lon };
const data = await fetchConditions(place, { start_date: shift(-3), end_date: shift(1) });

const file = new URL('./dives.json', import.meta.url);
const dives = JSON.parse(readFileSync(file, 'utf8')).filter((d) => !(d.date === date && d.from === from));
dives.push({ date, from, to, place, rating: +rating, note, data });
dives.sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
writeFileSync(file, JSON.stringify(dives) + '\n');
console.log(`dives.json: ${dives.length} dive(s), saved ${date} ${from}-${to} ${name}`);
