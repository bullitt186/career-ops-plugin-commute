// @ts-check
// career-ops-plugin-commute: drive time from home to each posting → data/commute.tsv.
//
// `node plugins.mjs run commute` runs one incremental update through ctx.fetch
// (allowedHosts + SSRF guard apply), with the settings from config/plugins.yml →
// plugins.commute. The hook returns no postings: this plugin enriches, it does
// not source jobs. Which hook fits that is an open question upstream
// (career-ops-hq/career-ops#4827); `ingest` follows h1b-sponsor.
import { update } from './lib/core.mjs';

export default {
  async ingest(ctx) {
    if (ctx.dryRun) { ctx.log('commute: dry run, nothing looked up'); return []; }
    await update(process.cwd(), { settings: ctx.settings || {}, fetch: ctx.fetch, log: (m) => ctx.log(m) });
    return [];
  },
};
