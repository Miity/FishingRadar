// UI: rendering, interaction, localStorage. Scoring lives in score.js, Open-Meteo calls in openmeteo.js.
// Same ?v= as app.js (set in index.html), so cached modules never mix with a new app.js.
const ver = new URL(import.meta.url).search;
const { MODEL, hourlyScores, dailyScores, moonPhase, label, stars } = await import(`./score.js${ver}`);
const { api, getJson, fetchConditions } = await import(`./openmeteo.js${ver}`);

const HOUR = 3600e3, DAYS = 10;
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let place = store.get('place', { name: 'Gaeta, Lazio', lat: 41.2138, lon: 13.5713 });
let mode = store.get('mode', 'sea');
// fcData: forecast for `place`; data: whatever day is open (forecast or a logged dive). selected: 'f<i>' or 'd<i>'.
let fcData, data, daily = [], dives = [], selected = 'f0', nowLocal = 0;

const hh = (t) => String(new Date(t).getUTCHours()).padStart(2, '0') + ':00';
const fmt = (v, unit, d = 1) => (v == null ? '—' : v.toFixed(d) + unit);
const status = (s) => ($('#status').textContent = s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const MOON = ['молодик', 'молодий серп', 'перша чверть', 'зростаючий', 'повня', 'спадний', 'остання чверть', 'старий серп'];
const FACTORS = {
  light: 'Світанок / захід', temp: 'Температура води', waves: 'Хвилі', wind: 'Вітер', water: 'Рух води', moon: 'Фаза Місяця',
  turbidity: 'Каламуть від хвиль', preStorm: 'Перед штормом', weekend: 'Вихідні',
};
const LEVELS = ['легко', 'середньо', 'складно', 'небезпечно'];
const CAUSE = { waves: ['хвиля', ' м', 1], wind: ['вітер', ' м/с', 0], current: ['течія', ' м/с', 1] };
const causeText = (x) => { const [what, unit, dec] = CAUSE[x.cause]; return `${what} ${x.value.toFixed(dec)}${unit}`; };
const diffText = (x) => (x.cause ? `${LEVELS[x.level]} · ${causeText(x)}` : LEVELS[x.level]);
const diffBadge = (x) => `<span class="df"><i class="lvl l${x.level}"></i>${LEVELS[x.level]}</span>`;

async function load() {
  status('Завантаження…');
  $('#place').textContent = place.name;
  document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode));
  try {
    fcData = await fetchConditions(place, { past_days: 3, forecast_days: DAYS }, mode !== 'fresh');
    nowLocal = Date.now() + fcData.utcOffsetMs;
    const today = new Date(nowLocal).toISOString().slice(0, 10);
    daily = dailyScores(hourlyScores(fcData, mode), bestN()).filter((d) => d.day >= today).slice(0, DAYS).map((d) => ({ ...d, data: fcData }));
    if (selected[0] === 'f') selected = 'f0';
    const noSea = mode !== 'fresh' && fcData.sst.every((v) => v == null) && fcData.wave.every((v) => v == null);
    status(noSea ? 'Морських даних для цієї точки немає: хвилі й рух води не враховано, температура води — за повітрям.' : '');
    render();
  } catch (e) {
    status(`Не вдалося отримати дані: ${e.message}`);
  }
}

const bestN = () => (mode === 'spear' ? MODEL.spear.bestHours : MODEL.bestHours);
const weekday = (day) => new Date(day + 'T00:00Z').toLocaleDateString('uk', { weekday: 'short', timeZone: 'UTC' });
const card = (d, key, wd, dn, extra = '') => `<button class="day${key === selected ? ' sel' : ''}" data-k="${key}" aria-label="${wd} ${dn}: ${d.score}">
  <span class="wd">${wd}</span><span class="dn">${dn}</span><span class="sc">${d.score}</span>
  <span class="bar"><i style="height:${d.score}%"></i></span>${d.diff ? diffBadge(d.diff) : ''}${extra}</button>`;
const rating = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const minutes = (hm) => (+hm.slice(0, 2) * 60 + +hm.slice(3)) * 60e3;

function render() {
  $('#days').innerHTML = daily.map((d, i) => card(d, 'f' + i, i === 0 ? 'Сьогодні' : weekday(d.day), new Date(d.day + 'T00:00Z').getUTCDate())).join('');
  // Logged dives (dives.json, added with add-dive.mjs), scored with the current model and mode.
  const diveDays = dives.map((v) => ({ ...dailyScores(hourlyScores(v.data, mode), bestN()).find((x) => x.day === v.date), data: v.data, dive: v }));
  $('#dives').innerHTML = diveDays.length ? `<h2>Журнал занурень</h2><nav>${diveDays.map((d, i) =>
    card(d, 'd' + i, weekday(d.day), `${d.day.slice(8)}.${d.day.slice(5, 7)}`, `<span class="mine" title="${esc(d.dive.place.name)}">${rating(d.dive.rating)}</span>`)).join('')}</nav>` : '';
  const d = selected[0] === 'd' ? diveDays[+selected.slice(1)] : daily[+selected.slice(1)];
  if (!d) return;
  data = d.data;
  const v = d.dive;
  const best = d.hours.reduce((a, h) => (h.score > a.score ? h : a));
  const phase = moonPhase(d.hours[12 % d.hours.length].t - data.utcOffsetMs);
  $('#detail').innerHTML = `
    <div class="hero"><span class="big">${d.score}</span>
      <span><span class="stars">${'★'.repeat(stars(d.score))}${'☆'.repeat(4 - stars(d.score))}</span><br>
      <span class="sub">${label(d.score)} активність · Місяць: ${MOON[Math.round(phase * 8) % 8]}</span></span></div>
    ${v ? `<div class="sub">Занурення ${d.day.slice(8)}.${d.day.slice(5, 7)}.${d.day.slice(0, 4)}: ${esc(v.place.name)} · ${v.from}–${v.to} · <span class="stars">${rating(v.rating)}</span>${v.note ? ` · ${esc(v.note)}` : ''}</div>` : ''}
    <div class="sub">Найкращий час: ${windows(d.hours).join(', ')}</div>
    ${d.diff ? `<div class="sub">Складність: ${diffBadge(d.diff)}${d.diff.cause ? ` · ${causeText(d.diff)}` : ''}</div>` : ''}
    ${riseWarning(d.hours)}
    <div class="chart">${chart(d.hours, v)}<div id="tip"></div></div>
    <table id="factors"></table>
    <details><summary>Таблиця по годинах</summary><table>
      <tr><th>Година</th><th>Оцінка</th><th>Вода</th><th>Вітер</th><th>Хвилі</th>${d.diff ? '<th>Течія</th><th>Складність</th>' : ''}</tr>
      ${d.hours.map((h) => { const r = raw(h.t); return `<tr><td>${hh(h.t)}</td><td>${h.score}</td><td>${fmt(h.waterTemp, '°')}</td><td>${fmt(r.wind, ' м/с')}</td><td>${fmt(r.wave, ' м')}</td>${
        h.diff ? `<td>${fmt(r.current, ' м/с')}</td><td>${LEVELS[h.diff.level]}</td>` : ''}</tr>`; }).join('')}
    </table></details>`;
  showFactors(best);
  bindHover(d.hours);
}

const raw = (t) => { const i = data.time.indexOf(t); return { wind: data.wind[i], wave: data.wave[i], current: data.current[i] }; };

function riseWarning(hs) {
  if (mode !== 'spear') return '';
  const h = hs.find((x) => !x.night && x.rise >= MODEL.spear.riseWarn);
  return h ? `<p class="warn">⚠ Хвиля зростає: +${h.rise.toFixed(1)} м за 3 год від ${hh(h.t)}. Не заходьте у воду на підйомі хвилі.</p>` : '';
}

function windows(hs) {
  const max = Math.max(...hs.map((h) => h.score)), cut = 0.85 * max, out = [];
  if (max === 0) return ['умови непридатні'];
  for (const h of hs) {
    if (h.score < cut) continue;
    const last = out.at(-1);
    if (last && h.t - last.end === HOUR) last.end = h.t;
    else out.push({ start: h.t, end: h.t });
  }
  const day = new Date(hs[0].t).toISOString().slice(0, 10);
  const sunset = mode === 'spear' && data.sunset.find((t) => new Date(t).toISOString().startsWith(day));
  const hm = (t) => new Date(t).toISOString().slice(11, 16);
  return out.map((w) => `${hm(w.start)}–${hm(sunset ? Math.min(w.end + HOUR, sunset) : w.end + HOUR)}`);
}

function showFactors(h) {
  const r = raw(h.t);
  const extra = {
    temp: fmt(h.waterTemp, ' °C'), waves: fmt(r.wave, ' м'), wind: fmt(r.wind, ' м/с'),
    turbidity: h.ub == null ? '' : `дно ${h.ub.toFixed(2)} м/с`,
  };
  const names = { ...FACTORS, ...(mode === 'spear' && { light: 'Ранок / вечір' }) };
  $('#factors').innerHTML = `<tr><th>${hh(h.t)} · оцінка ${h.score}${h.night ? ' (ніч: заборонено)' : ''}</th><th></th><th>Множник</th></tr>` +
    Object.keys(h.f).map((k) => `<tr><td>${names[k]}</td><td>${extra[k] ?? ''}</td><td>×${h.f[k].toFixed(2)}</td></tr>`).join('') +
    (h.diff ? `<tr><td>Складність</td><td colspan="2">${diffText(h.diff)}</td></tr>` : '');
}

// Chart geometry in CSS pixels; W follows the container so text stays 11px on phones.
let W = 720;
const H = 220, L = 8, R = 8, T = 10, B = 24;
const x = (t, t0) => L + ((t - t0) / HOUR / 23) * (W - L - R);
const y = (s) => T + (1 - s / 100) * (H - T - B);

function chart(hs, dive) {
  W = Math.max(280, $('#detail').clientWidth);
  const t0 = Date.parse(new Date(hs[0].t).toISOString().slice(0, 10) + 'T00:00Z');
  const p = hs.map((h) => [x(h.t, t0), y(h.score)]);
  let line = `M${p[0]}`;
  for (let i = 1; i < p.length; i++) line += ` Q${p[i - 1]} ${(p[i - 1][0] + p[i][0]) / 2},${(p[i - 1][1] + p[i][1]) / 2}`;
  line += ` L${p.at(-1)}`;
  const area = `${line} L${p.at(-1)[0]},${y(0)} L${p[0][0]},${y(0)} Z`;
  const grid = [[35, 'низька'], [60, 'середня'], [80, 'висока']].map(([s, n]) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(s)}" y2="${y(s)}" stroke="var(--grid)"/><text x="${L + 4}" y="${y(s) - 3}">${n}</text>`).join('');
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21].map((k) =>
    `<text x="${x(t0 + k * HOUR, t0)}" y="${H - 6}" text-anchor="middle">${String(k).padStart(2, '0')}</text>`).join('');
  const day = new Date(t0).toISOString().slice(0, 10);
  const sun = [...data.sunrise, ...data.sunset].filter((t) => new Date(t).toISOString().startsWith(day)).map((t) =>
    `<line x1="${x(t, t0)}" x2="${x(t, t0)}" y1="${T}" y2="${y(0)}" stroke="var(--muted)" stroke-width="1" opacity=".5"/>`).join('');
  const win = dive ? `<rect x="${x(t0 + minutes(dive.from), t0)}" y="${T}" width="${x(t0 + minutes(dive.to), t0) - x(t0 + minutes(dive.from), t0)}" height="${y(0) - T}" fill="var(--wash)"/>` : '';
  const now = nowLocal >= t0 && nowLocal < t0 + 24 * HOUR
    ? (() => { const h = hs.reduce((a, b) => (Math.abs(b.t - nowLocal) < Math.abs(a.t - nowLocal) ? b : a));
        return `<circle cx="${x(nowLocal, t0)}" cy="${y(h.score)}" r="5" fill="var(--series)" stroke="var(--bg)" stroke-width="2"/>`; })()
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Оцінка по годинах">
    ${win}${grid}${sun}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--grid)"/>
    <path d="${area}" fill="var(--wash)"/><path d="${line}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round"/>
    ${ticks}${now}<line id="cross" y1="${T}" y2="${y(0)}" stroke="var(--text-2)" stroke-width="1" visibility="hidden"/>
    <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg>`;
}

function bindHover(hs) {
  const svg = $('.chart svg'), tip = $('#tip'), cross = $('#cross');
  const t0 = Date.parse(new Date(hs[0].t).toISOString().slice(0, 10) + 'T00:00Z');
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    const h = hs.reduce((a, b) => (Math.abs(x(b.t, t0) - vx) < Math.abs(x(a.t, t0) - vx) ? b : a));
    const px = x(h.t, t0);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    tip.style.display = 'block';
    tip.textContent = `${hh(h.t)} · ${h.score} · вода ${fmt(h.waterTemp, '°')}`;
    tip.style.left = `${Math.min(Math.max(0, (px / W) * box.width - tip.offsetWidth / 2), box.width - tip.offsetWidth)}px`;
    showFactors(h);
  });
  svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });
}

function setPlace(p) { place = p; store.set('place', p); $('#results').innerHTML = ''; load(); }

// Only width matters: mobile browsers fire resize on scroll (URL bar), which would reset the hover.
addEventListener('resize', () => daily.length && Math.max(280, $('#detail').clientWidth) !== W && render());
document.addEventListener('click', (e) => {
  const b = e.target.closest('.day');
  if (b) { selected = b.dataset.k; render(); }
});
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; store.set('mode', mode); load(); }));
$('#search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q) return;
  try {
    const r = await getJson(api('geocoding-api.open-meteo.com', 'search', { name: q, count: 6, language: 'uk' }));
    $('#results').innerHTML = (r.results ?? []).map((g, i) =>
      `<li><button data-i="${i}">${esc([g.name, g.admin1, g.country].filter(Boolean).join(', '))}</button></li>`).join('') || '<li>Нічого не знайдено</li>';
    $('#results').onclick = (ev) => {
      const g = r.results?.[ev.target.closest('button')?.dataset.i];
      if (g) setPlace({ name: [g.name, g.admin1].filter(Boolean).join(', '), lat: g.latitude, lon: g.longitude });
    };
  } catch (err) { status(`Пошук не вдався: ${err.message}`); }
});
$('#geo').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(
  (p) => setPlace({ name: `Моє місце (${p.coords.latitude.toFixed(2)}, ${p.coords.longitude.toFixed(2)})`, lat: p.coords.latitude, lon: p.coords.longitude }),
  () => status('Геолокація недоступна'),
));

load();
getJson(`dives.json${ver}`).then((x) => { dives = x; render(); }).catch(() => {});
