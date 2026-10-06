#!/usr/bin/env node
// Standalone CLI, for setups that run the commute update outside the career-ops
// plugin engine (cron, a container's daily job). Inside career-ops use
// `node plugins.mjs run commute`, which routes all egress through ctx.fetch.
//
//   node commute.mjs [update]   tracker + pending pipeline rows → data/commute.tsv
//   node commute.mjs pending    triage lines for the pending pipeline (no network)
//
// Settings from the environment (the plugin reads the same keys, lower-case and
// without the prefix, from config/plugins.yml → plugins.commute):
//   CAREER_OPS_DIR                          career-ops checkout (default: current directory)
//   COMMUTE_HOME_LAT, COMMUTE_HOME_LON      home as coordinates (required)
//   COMMUTE_ROUTER                          valhalla | osrm (default valhalla)
//   COMMUTE_ROUTER_URL                      your routing backend, e.g. http://localhost:8002 (required)
//   COMMUTE_TIME_FACTOR, COMMUTE_MAX_MINUTES
//   COMMUTE_NOMINATIM_URL, COMMUTE_NOMINATIM_EMAIL, COMMUTE_NOMINATIM_GAP_MS
import path from 'node:path';
import { update, pending } from './lib/core.mjs';

const root = path.resolve(process.env.CAREER_OPS_DIR || process.cwd());

if (process.argv[2] === 'pending') {
  const lines = pending(root);
  process.stdout.write(lines.length ? `# Pending postings (token | company | title | location | drive | link)\n${lines.join('\n')}\n` : '');
} else {
  const settings = Object.fromEntries(Object.entries(process.env)
    .filter(([k]) => k.startsWith('COMMUTE_'))
    .map(([k, v]) => [k.slice('COMMUTE_'.length).toLowerCase(), v]));
  const r = await update(root, { settings, fetch: globalThis.fetch });
  if (r.failed) process.exitCode = 1;
}
