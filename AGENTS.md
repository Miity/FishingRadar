# FishingRadar

Static web page that rates fishing conditions 0–100 per hour and per day (10-day strip + hourly curve) for any location. Free alternative to the "fish activity" tab of paid apps. No backend, no API keys, no accounts.

## Stack
- Plain HTML + vanilla JS (ES modules), no build step, no npm dependencies.
- Hosted on GitHub Pages from `main` (repo root).
- Add a dependency only when a few lines of code can't do the job. Pin exact CDN versions if one is ever added.

## Files
- `index.html` — markup and styles.
- `app.js` — data fetching, rendering, interaction (owns the API and localStorage).
- `score.js` — pure scoring functions. No DOM, no network. Everything here must be testable in Node.
- `score.test.js` — `node score.test.js`, plain `node:assert`, synthetic data.

Split a file only when one of these fires (no judgment calls):
- file > ~250–300 lines;
- block owns its own state or external dependency (API, storage);
- block is actually reused in 2+ places (on the second real use);
- block must be tested in isolation;
- a stateless function called from one place stays where it's called.

## Data sources (Open-Meteo, free, CORS-enabled, no key)
- Forecast `api.open-meteo.com/v1/forecast`: `temperature_2m`, `wind_speed_10m` (m/s), daily `sunrise`/`sunset`; `past_days=3` for lag features.
- Marine `marine-api.open-meteo.com/v1/marine`: `sea_surface_temperature`, `wave_height`, `wave_period`, `sea_level_height_msl` (includes tides). Values are null inland — every factor must degrade to neutral (1.0) on missing data.
- Geocoding `geocoding-api.open-meteo.com/v1/search`.
- Moon phase is computed locally (synodic month from a reference new moon).

The cloud dev container's network blocks Open-Meteo: verify logic with `score.test.js` and UI with mocked responses, never assume live calls were tested.

## Scoring model
Evidence-based, not solunar. Literature review (2010+) summary:
- Strong, consistent: water temperature, light (dawn/dusk), water movement (current/tide), waves/wind with an optimum.
- Weak and species-dependent: moon phase → small weight, peaks at new AND full moon (`cos(4πφ)`).
- No direct effect in peer-reviewed tests: barometric pressure, solunar major/minor periods → not used.

Form: log-linear (GLM-style) — hourly score is a **product of multipliers**, normalized to 0–100. Daily score = mean of the best 6 hours.
All weights and optima live in one `MODEL` constant in `score.js` — that is the calibration knob. Thermal optima are placeholders until calibrated with per-species data (e.g. FishBase) or the user's catch log.
Present the result as a rating of conditions, never as a catch probability (ML studies reach R² ≈ 0.2 at best).

### Spearfishing mode (`'spear'`, `MODEL.spear`)
Shore-entry breath-hold spearfishing. Built from the user's field notes (Gaeta) plus evidence; thresholds are unmeasured and must be calibrated with a dive log.
- Night = score 0: spearfishing is banned from sunset to sunrise in Italy (DPR 1639/1968, art. 129).
- Best: still-turbid water (fish see the diver late) — the first calm morning after a storm, or just before a storm when long swell already stirs the bottom. Clear water on day 2 is worse. Fish wariness also drops after days without hunters (Sbragaglia et al. 2018, flight initiation distance).
- Turbidity proxy: near-bottom orbital velocity `u_b = πH / (T·sinh(kh))` at depth 5 m (Eckart's approximation for k). Memory `M` = exponentially decayed (12 h) sum of `max(0, u_b − 0.2 m/s)`; multiplier `1 + 0.8·(1 − exp(−M/5))`.
- Current waves are a safety gate with an optimum (~0.5 m, flat calm ≈ ×0.8, ×0.5 at 0.9 m); wind logistic around 7 m/s.
- Morning bump ~1.5 h after sunrise; weekends ×0.9; moon and tide off. Day score = mean of the best 3 hours.
- UI warns when waves rise ≥ 0.4 m within 3 h (safety, not part of the score).

## Conventions
- Code, identifiers, comments: English. UI text: Ukrainian.
- `localStorage` only for per-viewer conveniences (last location, mode), always inside try/catch.
- Mark deliberate shortcuts with a `ponytail:` comment naming the ceiling and the upgrade path.
- Don't copy code, assets or texts from Fishing Points or other commercial apps.
- Never push or open a PR unless the user asked.

## Interaction rules
- A question ("why does X happen?") gets an explanation first; no scripts or skills unless asked.
- "Read/look at the skill" means read it, not run it.
- Before multi-file or multi-item work, restate the full scope in one line and confirm it.
- When the user says assets already exist, use them instead of placeholders.
