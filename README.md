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
    # nominatim_url: http://localhost:8080           # self-hosted geocoder on this machine (no rate gap)
    # nominatim_email: you@example.org               # identifies you to the public Nominatim, as its policy asks
    # nominatim_gap_ms: 2200                         # raise when several instances share one IP
```

Then:

```bash
node plugins.mjs run commute ingest           # all tracker + pending rows
node plugins.mjs run commute search "<url>"   # just one posting, e.g. while evaluating it
```

The plugin has two hooks, so `run` needs the hook name. The full run works in portions that fit the plugin engine's 15-second hook limit. If it reports `N left: run again`, run it again; after the first pass, runs are incremental and fast. The single-posting form takes a few seconds and is what the skill uses during `oferta`. It uses the `search` hook only because that is the one hook that takes an argument (see [#4827](https://github.com/career-ops-hq/career-ops/issues/4827)).

**Routing backend, and why the plugin asks for `localhost`.** The router receives your home coordinates, so the plugin only talks to a router you run yourself. Self-hosted Valhalla and OSRM speak plain HTTP. The plugin engine allows that only on loopback (`allowsLocalhost`), and private LAN addresses are blocked. So run the router on the same machine (both have official Docker images), or forward its port to `localhost`. The only other host the plugin reaches is `nominatim.openstreetmap.org`. A self-hosted geocoder (`nominatim_url`) works on `localhost` too, or with the standalone CLI.

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
