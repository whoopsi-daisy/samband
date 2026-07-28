<pre> ███████╗ █████╗ ███╗   ███╗██████╗  █████╗ ███╗   ██╗██████╗
 ██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔══██╗████╗  ██║██╔══██╗
 ███████╗███████║██╔████╔██║██████╔╝███████║██╔██╗ ██║██║  ██║
 ╚════██║██╔══██║██║╚██╔╝██║██╔══██╗██╔══██║██║╚██╗██║██║  ██║
 ███████║██║  ██║██║ ╚═╝ ██║██████╔╝██║  ██║██║ ╚████║██████╔╝
 ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝
</pre>

A real-time view of Swedish police event notices. Fetches polisen.se every 10
minutes into SQLite and serves a list, a map and statistics from it. Ships as a
single container with a bind-mounted data directory.

## Where things stand

| Piece | State |
|-------|-------|
| **polisen.se feed** | The live source. Refreshes every 10 minutes, backfills ~a week on a fresh database, renders the list/map/statistics views |
| **Deployment** | One path: pull the image from GHCR and run `docker compose up -d`. Building from source is an override file, for development |
| **Brottsplatskartan archive** | Opt-in importer for ~333k historic events (2016→). Loads an NDJSON dump in under a minute, or walks the API over a few hours. Live progress on `/stats` |
| **Archive in the UI** | Part of the dataset. Feed, map, search, filters and statistics read the imported events alongside the live feed; the live feed wins for the period it covers, the archive supplies everything before it |

## Quick start

```bash
mkdir -p /opt/samband && cd /opt/samband
curl -fsSLO https://raw.githubusercontent.com/whoopsi-daisy/samband/main/docker-compose.yml
curl -fsSLo .env https://raw.githubusercontent.com/whoopsi-daisy/samband/main/.env.example

# The container runs as uid 1001 and must own its data directory.
mkdir -p data && sudo chown -R 1001:1001 data

docker compose up -d
```

The app is on <http://localhost:3000>; `docker compose ps` should show
`(healthy)` within 40 seconds. Edit `.env` to set a port, credentials for
`/stats`, or a pinned release.

That is the whole deployment. Everything else — reverse proxies, updating,
rollback, backups, migrating an existing install — is in
**[docs/deploy.md](docs/deploy.md)**.

> **Do not change `TZ`.** The app parses Swedish wall-clock times out of event
> text and renders them back, so it must run as `Europe/Stockholm`. Anything
> else shifts every stored and displayed event by 1–2 hours. The image sets it;
> set it yourself for bare-metal installs.

### Building from source instead

For development, not deployment:

```bash
git clone https://github.com/whoopsi-daisy/samband.git && cd samband
mkdir -p data && sudo chown -R 1001:1001 data
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

| File | Purpose |
|------|---------|
| `docker-compose.yml` | The deployment. Pulls `ghcr.io/whoopsi-daisy/samband` |
| `docker-compose.build.yml` | Override that builds from the local `Dockerfile` |
| `.env.example` | Every setting, with defaults. Copy to `.env` |

## Importing the Brottsplatskartan archive

Optional. Pulls ~333,000 events going back to 2016 into `bpk_events` — far more
history than polisen.se's API exposes.

Put an NDJSON dump (one API event per line) in the data directory and start it
from `/stats`, or unattended:

```bash
cp brottsplatskartan.ndjson data/ && sudo chown 1001:1001 data/brottsplatskartan.ndjson

# in .env
BPK_IMPORT_ON_START=ndjson
BPK_IMPORT_SOURCE=brottsplatskartan.ndjson
```

Roughly 15,000 events a second from a local file, so a full archive lands in
under a minute. On later boots it runs an incremental API sync instead of
re-reading the file.

Progress is visible while it runs — a live panel on `/stats`, a server-sent
event stream, and a line in the container log every 15 seconds:

```bash
docker compose logs -f
[bpk] dump brottsplatskartan.ndjson: 142 000 lines (42.5%), 142 000 new, 0 already known
```

Without a dump, the importer can walk the API instead (a few hours, ~670
requests, resumable).

Imported events are part of the dataset as soon as the import finishes: the
statistics cover them, and search reaches back through every period they hold.
Where the two sources overlap, the live feed wins for the period it covers and
the archive supplies everything before it, so nothing is counted twice — the
statistics view names that boundary. Full guide, HTTP reference and the mapping
of dump fields to columns: **[docs/import.md](docs/import.md)**.

## Development

```bash
npm install
npm run dev            # http://localhost:3000
npm run lint
npm test               # 179 tests
npx tsc --noEmit
npm run build          # production build
```

Node 22+ (the image and CI use 24). The importer CLI runs against the same
database:

```bash
npm run import:bpk -- --from-ndjson=brottsplatskartan.ndjson
npm run import:bpk -- --mode=incremental
npm run import:bpk -- --probe
```

Releases are published by tagging; see **[docs/publishing.md](docs/publishing.md)**.

## Layout

```
src/
├── app/                     # Next.js App Router
│   ├── page.tsx             # Feed (Server Component)
│   ├── stats/               # Operational dashboard
│   └── api/
│       ├── events/          # GET  /api/events
│       ├── details/         # GET  /api/details
│       ├── health/          # GET  /api/health (container healthcheck)
│       ├── map/             # GET  /api/map
│       └── import/brottsplatskartan/
│           ├── route.ts     # status / start / cancel
│           └── stream/      # server-sent progress
├── components/              # Feed, map, statistics, dashboard, ImportPanel
├── hooks/
├── lib/
│   ├── db.ts                # SQLite: schema, migrations, queries
│   ├── policeApi.ts         # polisen.se client
│   ├── brottsplatskartan.ts # API-walking importer
│   ├── brottsplatskartanNdjson.ts  # dump importer
│   ├── brottsplatskartanRunner.ts  # the one in-flight import + live progress
│   ├── importSource.ts      # where a dump may be read from
│   └── rateLimit.ts
├── __tests__/
└── types/

scripts/                     # export-db.sh, import-db.sh, import-brottsplatskartan.ts
data/                        # bind-mounted: events.db, dumps (created at runtime)
docs/                        # deploy, import, publishing, reference
```

## Docs

- **[docs/deploy.md](docs/deploy.md)** — running it: proxies, updates, backups, migrating an existing install, troubleshooting
- **[docs/import.md](docs/import.md)** — the archive importer in full
- **[docs/publishing.md](docs/publishing.md)** — publishing images from your own fork
- **[docs/reference.md](docs/reference.md)** — endpoints, schema, configuration, views, shortcuts

## Tech

Next.js 16 (App Router) · TypeScript 6 · React 19 · SQLite via better-sqlite3 ·
Leaflet · Jest 30 · Docker (multi-stage, standalone output, non-root,
healthchecked)

## License

This project fetches data from public APIs. Please respect the terms of service
of [Polisen.se](https://polisen.se) and
[Brottsplatskartan](https://brottsplatskartan.se/).

Thanks to the Swedish Police for the public events API, OpenStreetMap
contributors, CartoDB and Leaflet.
