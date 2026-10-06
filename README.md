# career-ops-plugin-commute

A community plugin for [career-ops](https://github.com/career-ops-hq/career-ops): **drive time from your home to each posting's workplace**, so `oferta` evaluations and pipeline triage can weigh reachability as a fact instead of guessing from a city name.

> Status: pre-release. The plugin shape is being discussed upstream in [career-ops-hq/career-ops#4827](https://github.com/career-ops-hq/career-ops/issues/4827). It is not in the registry yet.

## What it does

For every tracker row and pending pipeline row it:

1. Geocodes the posting's location with Nominatim. For city-level hits it tries the employer's own site near that city (within 25 km). State and country centroids are rejected as workplaces.
2. Routes from your home to that point with **your own** Valhalla or OSRM.
3. Writes `data/commute.tsv`: `url, location, precision, lat, lon, km, min, checked, factor`.

Runs are incremental. Only new postings, changed locations or a changed `time_factor` are looked up again, and every geocoder answer is cached in `data/.geocode-cache.json`. Tracker rows without a Location column take their location from `data/scan-history.tsv`.

The companion `skill.md` tells your agent how to read the file during evaluations: the drive time is stated as a fact, rows above your limit are flagged, and `unknown` never counts as a penalty.

## Privacy

- **Your home is coordinates, never an address.** It is not geocoded and only goes to the routing backend you configure.
- **The geocoder only sees public data:** the postings' location text and employer names.
- **No routing backend by default.** Until you configure one, the plugin does nothing. Public demo routers would receive your home coordinates, so they are not offered as a default.

## Install

```bash
# Before listing: install directly from this repo at a pinned commit
node plugins.mjs add bullitt186/career-ops-plugin-commute --sha <40-hex-commit>
node plugins.mjs enable commute            # shows the capability card
node plugins.mjs enable commute --confirm  # grants it
```

## Configure

`config/plugins.yml`:

```yaml
plugins:
  commute:
    enabled: true
    home_lat: 53.7997        # your home, as coordinates
    home_lon: -1.5492
    router: valhalla         # or osrm
    router_url: http://localhost:8002
    time_factor: 1.0         # scale free-flow times to your real door-to-door times
    max_minutes: 45          # your limit; rows above it are flagged
    # nominatim_url: https://nominatim.example.org   # self-hosted geocoder (no rate gap)
    # nominatim_email: you@example.org               # identifies you to the public Nominatim, as its policy asks
    # nominatim_gap_ms: 2200                         # raise when several instances share one IP
```

Then run `node plugins.mjs run commute`.

**Routing backend.** Inside the plugin engine, egress is limited to the hosts in `manifest.json` and to `localhost`. Run Valhalla or OSRM on the same machine (both have official Docker images), or forward its port to `localhost`.

**`time_factor`.** Routers estimate free-flow times. Compare a few commutes you know, then set `time_factor` to `real / estimated`. Changing it recomputes every row.

## Standalone CLI

For setups that run the update outside career-ops, such as a cron job or a container, `commute.mjs` takes the same settings from the environment (`COMMUTE_HOME_LAT`, `COMMUTE_ROUTER_URL`, …; see the file header):

```bash
CAREER_OPS_DIR=~/career-ops COMMUTE_HOME_LAT=53.7997 COMMUTE_HOME_LON=-1.5492 \
COMMUTE_ROUTER_URL=http://localhost:8002 node commute.mjs
node commute.mjs pending   # triage lines for the pending pipeline, no network
```

## Develop

```bash
node test/core.test.mjs    # unit tests, stubbed network
node test/smoke.mjs        # manifest ↔ hooks
node <career-ops>/plugin-audit.mjs .
```

MIT licensed.
