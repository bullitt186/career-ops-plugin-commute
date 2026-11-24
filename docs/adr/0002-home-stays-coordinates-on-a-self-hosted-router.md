# ADR-0002: Home stays coordinates, routed only by a self-hosted router

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

A drive time needs the user's home location, which is personal data. The plugin
runs inside the career-ops plugin engine, which allows plain HTTP only on
loopback (`allowsLocalhost`) and blocks private LAN addresses. This ADR records
the decision as it stands in `README.md` (Privacy, Routing backend) and
`manifest.json`; it was made before ADRs existed.

## Decision

The home is configured as coordinates and never geocoded. It is sent only to a
routing backend the user runs and configures (Valhalla or OSRM, reached on
`localhost`). There is no default routing backend: without one, the plugin does
nothing. The only other host is `nominatim.openstreetmap.org` (or a self-hosted
Nominatim), which receives only the postings' public location text and employer
names. `manifest.json` allows exactly these hosts.

## Consequences

Users must run a router on the same machine or forward its port to `localhost`.
Public demo routers are never offered as a default, because they would receive
the home coordinates. Any new host is a visible change of the plugin's
capability card.

## Alternatives considered

A public routing service as default: would send the home coordinates to a third
party.
