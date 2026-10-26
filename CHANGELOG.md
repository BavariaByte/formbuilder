# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-10-25

### Security
- Pin the Node.js base images to 22.23.4 (Docker build/runtime stages and CI
  jobs), picking up the Node.js security release of 2026-10-21
  (CVE-2026-111497 Brotli out-of-bounds write, CVE-2026-105482 dns.resolve NUL
  truncation, CVE-2026-106069 TLS IPv4 cert check bypass, CVE-2026-105481
  keep-alive request smuggling, updated c-ares, OpenSSL, Undici and root
  certificates).
- Refresh the npm lockfile to resolve all `npm audit` findings (8 → 0):
  vite 7.3.6 → 7.3.7 (GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw,
  GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22), vitest /
  @vitest/mocker 4.1.10 → 4.1.12 (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8),
  vue / @vue/server-renderer 3.5.26 → 3.5.44 (GHSA-g2v6-rqmx-r4w6),
  brace-expansion 5.0.9 → 5.0.12 (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7,
  GHSA-6j4f-fj2g-mc7p), postcss-selector-parser 7.1.4 → 7.1.7
  (GHSA-rj75-hqrm-r3gf), source-map-js 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q).

## [1.0.0] - 2026-08-09
### Added
- First public release: visual low-code editor for designing GIRP incident
  response playbooks, built with Vue 3, TypeScript and Rete.js v2.
