// @ts-check
// Car commute from home to each posting's workplace → data/commute.tsv.
//
// Pure parsing helpers plus createCommute(), which does the network part with an
// injected `fetch` — ctx.fetch inside the career-ops plugin engine, the global
// fetch in the standalone CLI. Nothing here reaches the network on its own.
//
// Settings (config/plugins.yml → plugins.commute, or COMMUTE_* env in the CLI):
//   home_lat, home_lon   home as coordinates; the home address is never geocoded
//   router, router_url   valhalla | osrm, and your own backend (required)
//   time_factor          scales free-flow router times to real door-to-door times
//   max_minutes          your limit, reported in the summary
//   nominatim_url, nominatim_email, nominatim_gap_ms
// Home only ever goes to the routing backend you configured. The geocoder only
// sees the postings' public locations and employer names.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const COLS = ['url', 'location', 'precision', 'lat', 'lon', 'km', 'min', 'checked', 'factor'];

// Work-mode words in the languages postings commonly use. Data, not a country assumption.
const REMOTE = /^(remote|fully remote|home ?office|work from home|wfh|anywhere|worldwide|nationwide|countrywide|telework|t[ée]l[ée]travail|teletrabajo|smart ?working|deutschlandweit|bundesweit)\b/i;
const NOT_A_PLACE = /^(remote|hybrid|on-?site|home ?office|n\/?a|tbd|-|—|\?)$/i;
// "Berlin or Munich", "Lyon et Paris", "Karlsruhe bzw. München": the first place wins.
const ALTERNATIVES = /\s*[;|]\s*|\s+(?:or|and|oder|und|bzw\.?|ou|et|o|y)\s+|\s+\/\s+/i;
// Nominatim place_rank below this is a state or country centroid, not a workplace.
const MIN_PLACE_RANK = 12;
// City-states (Berlin, Hamburg, Vienna) rank like a state but are cities.
const SETTLEMENT = new Set(['city', 'town', 'village', 'municipality', 'suburb', 'borough']);
const MAX_SITE_KM = 25;

/** Free-text job location → Nominatim query, 'remote', or null. */
export function placeQuery(loc) {
  let s = String(loc || '').replace(/\((?:remote|hybrid|on-?site)[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
  if (!s || s === '—') return null;
  if (REMOTE.test(s)) return 'remote';
  s = s.split(ALTERNATIVES)[0];
  s = s.split(/\s*,\s*/).filter((p) => p && !NOT_A_PLACE.test(p)).join(', ');
  s = s.replace(/^greater (.+?) area$/i, '$1');   // LinkedIn metro labels
  return s && !/^posted:/i.test(s) ? s : null;
}

/** Nominatim place_rank → how exact the point is. */
export const precisionOf = (rank) => (rank >= 26 ? 'address' : rank >= 17 ? 'district' : 'city');

/**
 * Employer name → search term without legal forms, group or region suffixes
 * ("Acme GmbH & Co. KG", "Acme S.A.S.", "ZEISS Group" → "Acme", "ZEISS"). The
 * first word always stays ("SAS Institute"). null when nothing usable is left.
 */
export function cleanCompany(name) {
  const s = String(name || '').replace(/\([^)]*\)/g, ' ').split(/\s+[/|]\s+/)[0]
    .replace(/(?<=\S\s+)(?:s\.?\s?a\.?\s?r\.?\s?l|s\.?\s?a\.?\s?s|s\.?\s?r\.?\s?l|s\.?\s?p\.?\s?a|s\.?\s?l|s\.?\s?a|b\.?\s?v|n\.?\s?v|sp\.?\s?z\s?o\.?\s?o|e\.?\s?v|k\.?\s?k)\.?(?![\p{L}\p{N}])/giu, ' ')
    .replace(/(?<=\S\s+)\b(gmbh|mbh|ag|se|kgaa|kg|co|gbr|ug|ltd|limited|inc|llc|plc|corp|corporation|oy|oyj|ab|asa|as|aps|pty|group|gruppe|groupe|grupo|holding|international|europe|emea|americas|apac|latam|global)\b\.?/gi, ' ')
    .replace(/[^\p{L}\p{N}&.\- ]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^[&\-\s]+|[&\-\s]+$/g, '');
  return s.length >= 2 && s !== '?' ? s : null;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const httpUrl = (s) => (String(s || '').match(/https?:\/\/[^\s|)\]]+/) || [])[0] || '';

/**
 * data/applications.md → [{url, company, location}], columns found by header name.
 * The Location column is optional in career-ops; without it `location` is '' and
 * the caller fills it from scan-history. Without a URL column the URL comes from
 * the linked report's `**URL:**` line (reportUrl(path)).
 */
export function trackerJobs(text, reportUrl = (_f) => '') {
  const lines = String(text || '').split('\n').filter((l) => l.trim().startsWith('|'));
  const head = lines.findIndex((l) => /^\|\s*#\s*\|/.test(l));
  if (head < 0) return [];
  const h = cells(lines[head]).map((c) => c.toLowerCase());
  const col = (...names) => h.findIndex((c) => names.includes(c));
  const [iLoc, iUrl, iCo, iRep] = [col('location', 'ort', 'lieu', 'ubicación'), col('url'), col('company', 'firma', 'empresa', 'entreprise'), col('report')];
  const report = (cell) => (String(cell || '').match(/\]\((?:\.\.\/)?(reports\/[^)\s]+\.md)\)/) || [])[1];
  return lines.slice(head + 1).filter((l) => !/^\|[\s|:-]+\|$/.test(l)).map(cells)
    .map((c) => ({
      url: httpUrl(c[iUrl]) || (report(c[iRep]) ? httpUrl(reportUrl(report(c[iRep]))) : ''),
      company: iCo >= 0 ? c[iCo] || '' : '',
      location: iLoc >= 0 && c[iLoc] !== '—' ? c[iLoc] || '' : '',
    }))
    .filter((j) => j.url);
}

/** All pending rows `- [ ] url | company | title | location | …` incl. the pick token (first cell). */
export function pendingRows(text) {
  return String(text || '').split('\n').filter((l) => /^-\s+\[ \]\s+/.test(l)).map((l) => cells(l.replace(/^-\s+\[ \]\s+/, '')))
    .map((c) => ({
      token: c[0], url: httpUrl(c[0]) || httpUrl(c.slice(4).join(' ')) || c[0], company: c[1] || '', title: c[2] || '',
      location: /^(posted|note):/i.test(c[3] || '') ? '' : (c[3] || ''),
    }));
}

/** Pending pipeline rows with a location → [{url, company, location}]. */
export function pipelineJobs(text) {
  return pendingRows(text).filter((j) => j.location).map(({ url, company, location }) => ({ url, company, location }));
}

/** data/scan-history.tsv → Map(url → location), for tracker rows without a Location column. */
export function scanLocations(tsv) {
  return new Map(readTsv(tsv).filter((r) => r.url && r.location).map((r) => [r.url, r.location]));
}

/** Triage input: `token | company | title | location | drive | link` per pending row not on hold. */
export function triageLines(pending, commuteByUrl, held = new Set()) {
  const drive = (r) => (!r ? '?' : r.precision === 'remote' ? 'remote' : r.min !== '' && r.min != null ? `${r.min} min` : '?');
  return pending.filter((j) => j.token && !held.has(j.token))
    .map((j) => [j.token, j.company || '?', j.title || '?', j.location || '?', drive(commuteByUrl.get(j.url)), /^https?:/.test(j.url) && j.url !== j.token ? j.url : '']
      .map((v) => String(v).replace(/\|/g, '/')).join(' | '));
}

export function haversineKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

export function readTsv(text) {
  const [head, ...rows] = String(text || '').trim().split(/\r?\n/);
  if (!head) return [];
  const h = head.split('\t');
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split('\t').map((v, i) => [h[i], v])));
}

export function writeTsv(rows) {
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]/g, ' ');
  return [COLS.join('\t'), ...rows.map((r) => COLS.map((c) => clean(r[c])).join('\t'))].join('\n') + '\n';
}

/** Home from the settings → {lat, lon} or null. Never geocoded. */
export function homeOf(s) {
  const ok = (v) => v !== '' && v != null && Number.isFinite(Number(v));
  return ok(s?.home_lat) && ok(s?.home_lon) ? { lat: Number(s.home_lat), lon: Number(s.home_lon) } : null;
}

const PUBLIC_NOMINATIM = 'https://nominatim.openstreetmap.org';

/**
 * Network side, with injected fetch.
 * @param {{ fetch: typeof globalThis.fetch, cache?: Record<string, any>, saveCache?: () => void,
 *   nominatimUrl?: string, email?: string, gapMs?: number, ua?: string,
 *   router?: 'valhalla'|'osrm', routerUrl: string, sleep?: (ms: number) => Promise<void> }} o
 */
export function createCommute(o) {
  // ctx.fetch throws on HTTP ≥ 400 (err.status), global fetch resolves with !ok.
  // Normalise to the latter, so "unroutable" (400) is not mistaken for "router down".
  const http = async (url, opts) => {
    try { return await o.fetch(url, opts); } catch (e) {
      if (e && typeof e.status === 'number') return { ok: false, status: e.status, json: async () => ({}) };
      throw e;
    }
  };
  const cache = o.cache || {};
  const save = o.saveCache || (() => {});
  const base = String(o.nominatimUrl || PUBLIC_NOMINATIM).replace(/\/+$/, '');
  // Public host: ≥1.1 s per its usage policy. A self-hosted geocoder has no limit unless set.
  const gap = base === PUBLIC_NOMINATIM ? Math.max(1100, o.gapMs || 0) : o.gapMs || 0;
  const email = o.email ? `&email=${encodeURIComponent(o.email)}` : '';
  const ua = o.ua || 'career-ops-plugin-commute (https://github.com/bullitt186/career-ops-plugin-commute)';
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const routerUrl = String(o.routerUrl || '').replace(/\/+$/, '');
  // A fresh process cannot know when the previous one last asked ("run again"
  // back to back), so its first lookup waits one gap too.
  let lastCall = Date.now();

  // Hits and misses are cached for good; a changed location is a new query anyway.
  // Entries from before the addresstype was stored are looked up again when they
  // would now decide between "city-state" and "region".
  async function search(q) {
    const hit = cache[q];
    if (Object.hasOwn(cache, q) && !(hit && hit.rank < MIN_PLACE_RANK && hit.at === undefined)) return hit;
    await sleep(Math.max(0, lastCall + gap - Date.now()));
    lastCall = Date.now();
    const res = await http(`${base}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}${email}`, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`); // 429 etc.: not cached, retried next run
    const [h] = await res.json();
    cache[q] = h ? { lat: +h.lat, lon: +h.lon, rank: +h.place_rank, type: h.category, at: h.addresstype || '' } : null;
    save();
    return cache[q];
  }

  /** Location (+ employer for city-level ones) → {lat, lon, precision}, {precision:'remote'} or null. */
  async function locate(job) {
    const q = placeQuery(job.location);
    if (!q) return null;
    if (q === 'remote') return { precision: 'remote' };
    const place = await search(q);
    if (!place || (place.rank < MIN_PLACE_RANK && !SETTLEMENT.has(place.at))) return null;
    if (place.rank >= 26) return { ...place, precision: 'address' };
    // City only: try the employer's site there, accept it near that city.
    const co = cleanCompany(job.company);
    const site = co && await search(`${co}, ${q}`);
    if (site && site.rank >= 26 && site.type !== 'highway' && haversineKm(site, place) <= MAX_SITE_KM) return { ...site, precision: 'poi' };
    return { ...place, precision: precisionOf(place.rank) };
  }

  /** Car route → {km, min} (min × factor); {} when unroutable, throws when the router is down. */
  async function route(from, to, factor = 1) {
    const down = (e) => { throw new Error(`router unreachable (${e.cause?.code || e.message})`); };
    if (o.router === 'osrm') {
      const res = await http(`${routerUrl}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`).catch(down);
      if (res.status >= 500) throw new Error(`router ${res.status}`);
      const body = res.ok ? await res.json() : {};
      const r = body.code === 'Ok' && body.routes && body.routes[0];
      return r ? { km: Math.round(r.distance / 1000), min: Math.round((r.duration / 60) * factor) } : {};
    }
    const res = await http(`${routerUrl}/route`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: [from, to].map((p) => ({ lat: p.lat, lon: p.lon })), costing: 'auto', units: 'kilometers', directions_type: 'none' }),
    }).catch(down);
    if (res.status >= 500) throw new Error(`router ${res.status}`);
    if (!res.ok) return {};
    const { trip } = await res.json();
    return { km: Math.round(trip.summary.length), min: Math.round((trip.summary.time / 60) * factor) };
  }

  return { search, locate, route };
}

// A job is at most two geocoder calls (≥1.1 s apart on the public host) plus one
// route: a new one only starts while this much of the budget is left.
const JOB_RESERVE_MS = 4000;

/**
 * One incremental run over a career-ops checkout: tracker first (its location
 * beats the pipeline's for the same URL), then pending pipeline rows. Only new
 * rows, changed locations or a changed time_factor are looked up again.
 *   only      one posting URL: just that row (an `oferta` evaluation's posting)
 *   budgetMs  stop starting new rows once the budget nears its end; the file is
 *             still written and `remaining` says how many rows the next run picks up
 * @param {string} root career-ops checkout
 * @param {{ settings: Record<string, any>, fetch: typeof globalThis.fetch, log?: (s: string) => void,
 *   only?: string, budgetMs?: number, now?: () => number }} o
 */
export async function update(root, o) {
  const log = o.log || console.log;
  const s = o.settings || {};
  const home = homeOf(s);
  if (!home) { log('commute: set home_lat / home_lon (coordinates; the home address is never geocoded); skipped'); return { skipped: true }; }
  if (!s.router_url) { log('commute: no routing backend configured (router_url); skipped'); return { skipped: true }; }
  const factor = Number(s.time_factor) > 0 ? Number(s.time_factor) : 1;
  const max = Number(s.max_minutes) || 60;
  const file = (f) => path.join(root, f);
  const read = (f) => (existsSync(file(f)) ? readFileSync(file(f), 'utf8') : '');
  const cacheFile = file('data/.geocode-cache.json');
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const c = createCommute({
    fetch: o.fetch, cache, saveCache: () => writeFileSync(cacheFile, JSON.stringify(cache)),
    router: s.router === 'osrm' ? 'osrm' : 'valhalla', routerUrl: s.router_url,
    nominatimUrl: s.nominatim_url, email: s.nominatim_email, gapMs: Number(s.nominatim_gap_ms) || 0,
  });

  const done = new Map(readTsv(read('data/commute.tsv')).map((r) => [r.url, r]));
  const scanLoc = scanLocations(read('data/scan-history.tsv'));
  // ponytail: plain path join; the report name comes from the user's own tracker, not from a posting
  const reportUrl = (f) => (read(f).match(/^\*\*URL:\*\*\s*(\S+)/m) || [])[1] || '';
  const jobs = new Map();
  for (const j of trackerJobs(read('data/applications.md'), reportUrl)) {
    const location = j.location || scanLoc.get(j.url) || '';
    if (location && !jobs.has(j.url)) jobs.set(j.url, { ...j, location });
  }
  for (const j of pipelineJobs(read('data/pipeline.md'))) if (!jobs.has(j.url)) jobs.set(j.url, j);

  const only = String(o.only || '').trim();
  if (only && !jobs.has(only)) {
    log(`commute: ${only} is not in the tracker or the pending pipeline (or has no location); nothing looked up`);
    return { added: 0, total: done.size, over: 0, failed: 0, remaining: 0 };
  }
  const now = o.now || Date.now;
  const start = now();
  const todo = [...jobs.values()].filter((job) => {
    if (only && job.url !== only) return false;
    const prev = done.get(job.url);
    return !(prev && prev.location === job.location && Number(prev.factor || 1) === factor);
  });

  let added = 0, failed = 0, remaining = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const [i, job] of todo.entries()) {
    if (o.budgetMs && now() - start > o.budgetMs - JOB_RESERVE_MS) { remaining = todo.length - i; break; }
    try {
      const p = await c.locate(job);
      const r = p?.lat != null ? await c.route(home, p, factor) : {};
      done.set(job.url, {
        url: job.url, location: job.location, precision: p?.precision || 'unknown',
        lat: p?.lat?.toFixed(5) ?? '', lon: p?.lon?.toFixed(5) ?? '', km: r.km ?? '', min: r.min ?? '', checked: today, factor,
      });
      added++;
    } catch (e) {
      failed++;
      log(`commute ${job.url}: ${e.message}`);
      if (/router|Nominatim 429/.test(e.message)) { remaining = todo.length - i - 1; break; } // service down / rate-limited: retry next run
    }
  }
  writeFileSync(file('data/commute.tsv'), writeTsv([...done.values()]));
  const over = [...done.values()].filter((r) => r.min !== '' && +r.min > max).length;
  log(`commute: ${added} updated, ${done.size} total, ${over} over ${max} min${remaining ? `, ${remaining} left: run again` : ''}${failed ? `, WARNING ${failed} failed` : ''}`);
  return { added, total: done.size, over, failed, remaining };
}

/** Triage lines for the pending pipeline, from data/commute.tsv. No network. */
export function pending(root) {
  const read = (f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : '');
  const byUrl = new Map(readTsv(read('data/commute.tsv')).map((r) => [r.url, r]));
  const held = new Set(read('data/held-picks.txt').split('\n').map((l) => l.trim()).filter(Boolean));
  return triageLines(pendingRows(read('data/pipeline.md')), byUrl, held);
}
