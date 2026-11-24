# Scope

What this project is for, so contributions go in the same direction. Changing this file is a
maintainer decision, recorded as an ADR.

## Purpose

A community plugin for [career-ops](https://github.com/career-ops-hq/career-ops) that computes
the drive time from the user's home to each posting's workplace, so evaluations and pipeline
triage can weigh reachability as a fact instead of guessing from a city name. It is for
career-ops users who want commute times without giving their home address to a third party.

## In scope

- Geocoding a posting's location text (Nominatim, public or self-hosted), including the
  employer's own site near the place.
- Car routing from the home coordinates with the user's own Valhalla or OSRM.
- Writing and incrementally updating `data/commute.tsv`, with a geocoder cache.
- The companion `skill.md` that tells the agent how to report the drive time.
- The `ingest` and `search` hooks and the standalone CLI `commute.mjs`.

## Out of scope

- Sourcing job postings: the plugin enriches existing rows, it returns no postings
  (`index.mjs`).
- Geocoding the home address: the home is coordinates only (ADR-0002).
- Public or hosted routing services as a default: they would receive the home coordinates
  (ADR-0002).
- Deciding how much a commute weighs: that is the user's own location policy in career-ops
  (`skill.md`).
- Other transport modes than car: Open: to be decided by the maintainer.

## Direction

Whether the per-posting lookup keeps using the `search` hook or gets a dedicated hook is asked
upstream in [career-ops-hq/career-ops#4827](https://github.com/career-ops-hq/career-ops/issues/4827).
CI for the tests: #1. Further direction: Open: to be decided by the maintainer.

## Principles

- Privacy first: the home goes only to a router the user runs (ADR-0002).
- Only the hosts in `manifest.json` are reached, and all network goes through an injected
  `fetch`.
- Runs fit the plugin engine's hook time limit and are incremental.
- `unknown` is no signal, never a penalty (`skill.md`).
