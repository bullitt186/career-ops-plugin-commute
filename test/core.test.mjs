// Zero-network unit tests: parsing helpers, and createCommute()/update() against a stubbed fetch.
// Plain node:assert (no test framework), so the file passes the career-ops plugin audit.
// Run: node test/core.test.mjs
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

import {
  placeQuery, precisionOf, cleanCompany, trackerJobs, pipelineJobs, pendingRows, triageLines,
  haversineKm, readTsv, writeTsv, homeOf, scanLocations, createCommute, update, pending,
} from '../lib/core.mjs';

test('placeQuery: work-mode noise off, first of several places, remote recognised', () => {
  assert.equal(placeQuery('Leeds, West Yorkshire, United Kingdom'), 'Leeds, West Yorkshire, United Kingdom');
  assert.equal(placeQuery('Lyon et Paris'), 'Lyon');
  assert.equal(placeQuery('Karlsruhe bzw. München'), 'Karlsruhe');
  assert.equal(placeQuery('Madrid o Barcelona'), 'Madrid');
  assert.equal(placeQuery('Leeds (Hybrid)'), 'Leeds');
  assert.equal(placeQuery('Hybrid, Leeds'), 'Leeds');
  assert.equal(placeQuery('Remote, Remote'), 'remote');
  assert.equal(placeQuery('Nationwide (home office)'), 'remote');
  assert.equal(placeQuery('Télétravail'), 'remote');
  assert.equal(placeQuery('Greater Leeds Area'), 'Leeds');
  assert.equal(placeQuery('1 Example Street, LS1 1AA Leeds'), '1 Example Street, LS1 1AA Leeds');
  assert.equal(placeQuery('—'), null);
  assert.equal(placeQuery(''), null);
});

test('precisionOf and cleanCompany', () => {
  assert.equal(precisionOf(30), 'address');
  assert.equal(precisionOf(18), 'district');
  assert.equal(precisionOf(16), 'city');
  assert.equal(cleanCompany('ZEISS Group'), 'ZEISS');
  assert.equal(cleanCompany('Acme GmbH & Co. KG'), 'Acme');
  assert.equal(cleanCompany('Acme S.A.S.'), 'Acme');
  assert.equal(cleanCompany('Atlassian Pty Ltd'), 'Atlassian');
  assert.equal(cleanCompany('SAS Institute'), 'SAS Institute');
  assert.equal(cleanCompany('?'), null);
});

const TRACKER = `| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes | URL |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-02 | Acme | Ops | Leeds | 3.5/5 | Evaluated | ❌ | [001](x.md) | n | https://jobs.example.com/1 |
| 2 | 2026-10-02 | X | Y | — | 3/5 | Evaluated | ❌ | [002](y.md) | n | https://e.com/2 |`;

test('trackerJobs: by header name; optional Location; URL from the report when there is no URL column', () => {
  assert.deepEqual(trackerJobs(TRACKER), [
    { url: 'https://jobs.example.com/1', company: 'Acme', location: 'Leeds' },
    { url: 'https://e.com/2', company: 'X', location: '' },
  ]);
  // career-ops default layout: no Location column.
  assert.deepEqual(trackerJobs(TRACKER.replace('Location', 'Notes2')).map((j) => j.location), ['', '']);
  const noUrl = TRACKER.replace(' URL |', ' X |').replace('https://jobs.example.com/1', '');
  const rep = (f) => (f === 'reports/001.md' ? 'https://r/1' : '');
  assert.equal(trackerJobs(noUrl, rep).length, 0); // links are x.md / y.md, not reports/: no URL anywhere
  assert.equal(trackerJobs(noUrl.replace('[001](x.md)', '[001](../reports/001.md)'), rep)[0].url, 'https://r/1');
});

const PIPE = `## Pending
- [ ] local:jds/board-4.md | Globex | Head | Lyon, France | note: board https://jobs.example.com/4
- [ ] https://e.com/j | Initech | Lead | Leeds Wellington Street |  | posted: 2026-10-02
- [x] https://e.com/old | A | B | Ulm
- [ ] https://e.com/news | ? | (newsletter)`;

test('pipelineJobs / pendingRows / triageLines', () => {
  assert.deepEqual(pipelineJobs(PIPE), [
    { url: 'https://jobs.example.com/4', company: 'Globex', location: 'Lyon, France' },
    { url: 'https://e.com/j', company: 'Initech', location: 'Leeds Wellington Street' },
  ]);
  const pend = pendingRows(PIPE);
  assert.equal(pend.length, 3);
  assert.deepEqual(triageLines(pend, new Map([['https://e.com/j', { min: '41' }], ['https://jobs.example.com/4', { precision: 'remote', min: '' }]]), new Set(['https://e.com/news'])), [
    'local:jds/board-4.md | Globex | Head | Lyon, France | remote | https://jobs.example.com/4',
    'https://e.com/j | Initech | Lead | Leeds Wellington Street | 41 min | ',
  ]);
});

test('tsv round trip, scan-history locations, home only from coordinates', () => {
  assert.deepEqual(readTsv('url\tmin\nhttps://a\t42\n'), [{ url: 'https://a', min: '42' }]);
  assert.deepEqual(readTsv(writeTsv([{ url: 'https://a', location: 'x\ty', min: 5 }]))[0].location, 'x y');
  assert.equal(scanLocations('url\tlocation\nhttps://a\tLeeds\nhttps://b\t\n').get('https://a'), 'Leeds');
  assert.deepEqual(homeOf({ home_lat: 53.8, home_lon: -1.55 }), { lat: 53.8, lon: -1.55 });
  assert.deepEqual(homeOf({ home_lat: '53.8', home_lon: '-1.55' }), { lat: 53.8, lon: -1.55 }); // env strings
  assert.equal(homeOf({ home: '1 Example Street, Leeds' }), null);
  assert.ok(Math.abs(haversineKm({ lat: 53.8, lon: -1.55 }, { lat: 53.48, lon: -2.24 }) - 55) < 5); // Leeds–Manchester
});

// Stub: Nominatim answers from a table; routers answer fixed trips. Records every URL.
function stub(places, { router = 'valhalla', down = false } = {}) {
  const calls = [];
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    if (url.includes('/search?')) return json(places[decodeURIComponent(url.match(/[?&]q=([^&]*)/)[1])] || []);
    if (down) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (router === 'osrm') return json({ code: 'Ok', routes: [{ distance: 41000, duration: 2400 }] });
    assert.equal(opts.method, 'POST');
    return json({ trip: { summary: { length: 41.2, time: 2400 } } });
  };
  return { fetch, calls };
}
const LEEDS = [{ lat: '53.80', lon: '-1.55', place_rank: 16, category: 'boundary', addresstype: 'city' }];
const BERLIN = [{ lat: '52.52', lon: '13.40', place_rank: 8, category: 'boundary', addresstype: 'city' }];
const REGION = [{ lat: '53.9', lon: '-1.6', place_rank: 8, category: 'boundary', addresstype: 'state' }];
const nosleep = async () => {};

test('locate: employer site near the city wins; regions are not workplaces; city-states are', async () => {
  const { fetch } = stub({
    Leeds: LEEDS, 'Acme, Leeds': [{ lat: '53.79', lon: '-1.54', place_rank: 30, category: 'office' }],
    'Far, Leeds': [{ lat: '51.5', lon: '-0.1', place_rank: 30, category: 'office' }],
    'West Yorkshire': REGION, Berlin: BERLIN,
  });
  const c = createCommute({ fetch, routerUrl: 'http://localhost:8002', sleep: nosleep });
  assert.equal((await c.locate({ location: 'Leeds', company: 'Acme Ltd' })).precision, 'poi');
  assert.equal((await c.locate({ location: 'Leeds', company: 'Far' })).precision, 'city');
  assert.equal(await c.locate({ location: 'West Yorkshire', company: '' }), null);
  assert.equal((await c.locate({ location: 'Berlin', company: '' })).precision, 'city');
  assert.deepEqual(await c.locate({ location: 'Remote', company: 'Acme' }), { precision: 'remote' });
});

test('route: valhalla and osrm shapes; factor applied; router down throws', async () => {
  const a = { lat: 53.8, lon: -1.55 }, b = { lat: 53.48, lon: -2.24 };
  const v = createCommute({ fetch: stub({}).fetch, routerUrl: 'http://localhost:8002/', sleep: nosleep });
  assert.deepEqual(await v.route(a, b, 0.9), { km: 41, min: 36 });
  const osrm = stub({}, { router: 'osrm' });
  const o = createCommute({ fetch: osrm.fetch, router: 'osrm', routerUrl: 'http://localhost:5000', sleep: nosleep });
  assert.deepEqual(await o.route(a, b), { km: 41, min: 40 });
  assert.equal(osrm.calls[0], 'http://localhost:5000/route/v1/driving/-1.55,53.8;-2.24,53.48?overview=false');
  const d = createCommute({ fetch: stub({}, { down: true }).fetch, routerUrl: 'http://localhost:8002', sleep: nosleep });
  await assert.rejects(d.route(a, b), /router unreachable \(ECONNREFUSED\)/);
});

test('update: incremental, home never sent to the geocoder, scan-history fills a missing Location', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'commute-'));
  mkdirSync(path.join(root, 'data'));
  writeFileSync(path.join(root, 'data/applications.md'), TRACKER.replace('Location', 'Notes2'));
  writeFileSync(path.join(root, 'data/scan-history.tsv'), 'url\tlocation\nhttps://jobs.example.com/1\tLeeds\n');
  writeFileSync(path.join(root, 'data/pipeline.md'), PIPE);
  const s = stub({ Leeds: LEEDS, 'Lyon, France': [{ lat: '45.76', lon: '4.84', place_rank: 16, category: 'boundary', addresstype: 'city' }] });
  const settings = { home_lat: 53.8, home_lon: -1.55, home: '1 Secret Street', max_minutes: 30, time_factor: 0.9, router_url: 'http://localhost:8002' };
  const logs = [];
  const r = await update(root, { settings, fetch: s.fetch, log: (m) => logs.push(m) });
  assert.equal(r.total, 3);
  assert.ok(s.calls.every((u) => !u.includes('Secret')), 'home address must never leave the machine');
  const rows = readTsv(readFileSync(path.join(root, 'data/commute.tsv'), 'utf8'));
  assert.deepEqual(rows.map((x) => [x.url, x.precision, x.min]), [
    ['https://jobs.example.com/1', 'city', '36'],
    ['https://jobs.example.com/4', 'city', '36'],
    ['https://e.com/j', 'unknown', ''],
  ]);
  assert.match(logs.at(-1), /3 updated, 3 total, 2 over 30 min/);
  // Second run: nothing changed, nothing looked up.
  const before = s.calls.length;
  assert.equal((await update(root, { settings, fetch: s.fetch, log: () => {} })).added, 0);
  assert.equal(s.calls.length, before);
  assert.equal(pending(root).length, 3);
});

test('ctx.fetch semantics (throws on HTTP >= 400): 400 = unroutable, 5xx = router down, 429 = Nominatim retry', async () => {
  const thrower = (status) => async () => { throw Object.assign(new Error(`HTTP ${status}`), { status }); };
  const a = { lat: 53.8, lon: -1.55 }, b = { lat: 60, lon: 5 };
  assert.deepEqual(await createCommute({ fetch: thrower(400), routerUrl: 'http://localhost:8002', sleep: nosleep }).route(a, b), {});
  await assert.rejects(createCommute({ fetch: thrower(503), routerUrl: 'http://localhost:8002', sleep: nosleep }).route(a, b), /router 503/);
  await assert.rejects(createCommute({ fetch: thrower(429), routerUrl: 'http://localhost:8002', sleep: nosleep }).search('Leeds'), /Nominatim 429/);
});

test('update: skipped without coordinates or without a router', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'commute-'));
  const calls = [];
  const fetch = async (u) => { calls.push(u); throw new Error('no network'); };
  assert.ok((await update(root, { settings: { home: 'x', router_url: 'http://localhost:8002' }, fetch, log: () => {} })).skipped);
  assert.ok((await update(root, { settings: { home_lat: '1', home_lon: '2' }, fetch, log: () => {} })).skipped);
  assert.equal(calls.length, 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n${e.stack}`); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed) process.exitCode = 1;
