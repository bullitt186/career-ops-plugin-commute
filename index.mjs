// @ts-check
// career-ops-plugin-commute: drive time from home to each posting → data/commute.tsv.
//
// Both hooks go through ctx.fetch (allowedHosts + SSRF guard apply) and use the
// settings from config/plugins.yml → plugins.commute. Neither returns postings:
// this plugin enriches, it does not source jobs.
//
//   node plugins.mjs run commute ingest           all tracker + pending rows, in portions
//                                                 that fit the engine's 15 s hook timeout;
//                                                 "N left: run again" until 0 left
//   node plugins.mjs run commute search "<url>"   just that posting (3-5 s), for an
//                                                 `oferta` evaluation
//
// `search` is used here because it is the only hook that takes an argument; it
// is an enrichment, not a search. Whether that is acceptable, or a dedicated hook
// would be better, is asked upstream in career-ops-hq/career-ops#4827.
import { update } from './lib/core.mjs';

// Under the engine's 15 s hook timeout, with room for the job in flight.
const BUDGET_MS = 10_000;

const run = (ctx, extra) => update(process.cwd(), { settings: ctx.settings || {}, fetch: ctx.fetch, log: (m) => ctx.log(m), ...extra });

export default {
  async ingest(ctx) {
    if (ctx.dryRun) { ctx.log('commute: dry run, nothing looked up'); return []; }
    await run(ctx, { budgetMs: BUDGET_MS });
    return [];
  },

  async search(query, ctx) {
    if (ctx.dryRun) { ctx.log('commute: dry run, nothing looked up'); return []; }
    await run(ctx, { only: String(query || '').trim() });
    return [];
  },
};
