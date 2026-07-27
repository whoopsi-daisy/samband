<pre> ███████╗ █████╗ ███╗   ███╗██████╗  █████╗ ███╗   ██╗██████╗
 ██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔══██╗████╗  ██║██╔══██╗
 ███████╗███████║██╔████╔██║██████╔╝███████║██╔██╗ ██║██║  ██║
 ╚════██║██╔══██║██║╚██╔╝██║██╔══██╗██╔══██║██║╚██╗██║██║  ██║
 ███████║██║  ██║██║ ╚═╝ ██║██████╔╝██║  ██║██║ ╚████║██████╔╝
 ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝
</pre>

A real-time Swedish police event notification service built with Next.js. Fetches and displays police events from the Swedish Police API with interactive maps and statistics.

## Features

- **Real-time Events** - Automatically fetches police events every 10 minutes
- **Multiple Views** - List, Map, and Statistics views
- **Interactive Map** - Leaflet-powered map showing events from the last 24 hours
- **Statistics Dashboard** - Visual charts showing event trends, top locations, and hourly distribution
- **Operational Dashboard** - System monitoring page at `/stats` with fetch logs and health metrics
- **Advanced Filtering** - Filter by location, event type, or search terms
- **Event Details** - Lazy-loaded detailed information for each event
- **Keyboard Shortcuts** - Quick navigation with keyboard shortcuts (1/2/3 for views, / for search)
- **Responsive Design** - Works on desktop, tablet, and mobile
- **PWA Support** - Installable as a Progressive Web App
- **Dark Theme** - Modern dark UI optimized for readability
- **Rate Limiting** - API protection with per-IP rate limiting

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with App Router and Turbopack
- **Language**: [TypeScript 6](https://www.typescriptlang.org/)
- **React**: [React 19](https://react.dev/)
- **Database**: [SQLite](https://www.sqlite.org/) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Maps**: [Leaflet](https://leafletjs.com/) (dynamic import, SSR-safe)
- **Testing**: [Jest 30](https://jestjs.io/) with [Testing Library](https://testing-library.com/)
- **Styling**: Custom CSS with CSS variables
- **Data Source**: [Swedish Police API](https://polisen.se/api/events)
- **Deployment**: Docker (multi-stage, standalone output, non-root, healthchecked)

## Getting Started

### Prerequisites

- Node.js 22.x or later (the container image and CI use Node 24)
- npm or yarn

> **Timezone matters.** The app parses Swedish wall-clock times out of event
> text (`"27 juli 14.30, Brand, Malmö"`) and renders them back, so it must run
> with `TZ=Europe/Stockholm`. Running under UTC shifts every stored and
> displayed event time by 1–2 hours. The Docker image sets this by default; set
> it yourself for bare-metal installs.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/doctorslop/samband.git
   cd samband
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm start
```

## Running with Docker

The recommended deployment. The image is a multi-stage build producing a
standalone Next.js server (~55 MB of app code, no devDependencies), running as
an unprivileged user with `TZ=Europe/Stockholm` and a healthcheck.

```bash
git clone https://github.com/doctorslop/samband.git
cd samband

# The data directory is bind-mounted; it must be writable by the container user.
mkdir -p data && sudo chown -R 1001:1001 data

docker compose up -d --build
```

The app is then on <http://localhost:3000>. Check it came up:

```bash
docker compose ps          # should show (healthy)
docker compose logs -f
curl -s http://localhost:3000/api/health
```

On an empty database the first fetch backfills roughly a week of events from
polisen.se, so give it a minute before the feed looks populated.

### Configuration

Compose reads these from the environment or an `.env` file next to
`docker-compose.yml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `SAMBAND_PORT` | `3000` | Host port to publish. |
| `TZ` | `Europe/Stockholm` | Container timezone. Changing this corrupts event times — see the warning above. |
| `RATE_LIMIT_PROXY_HOPS` | `1` | Trusted reverse-proxy hops in front of the app. |

The image itself also honours `SAMBAND_DATA_DIR` (default `/app/data`), which
is where `events.db` lives.

### Running the pre-built image

Released images are published to the GitHub Container Registry, so you can skip
the build entirely:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

Or without compose:

```bash
mkdir -p data && sudo chown -R 1001:1001 data
docker run -d --name samband \
  -p 3000:3000 \
  -e TZ=Europe/Stockholm \
  -v "$PWD/data:/app/data" \
  ghcr.io/whoopsi-daisy/samband:latest
```

Available tags:

| Tag | Points at |
|-----|-----------|
| `latest` | Newest stable release |
| `1.2.3` | That exact release — use this for reproducible deployments |
| `1.2` | Newest patch of 1.2 |
| `1` | Newest minor of 1.x |
| `edge` | Newest commit on `main`, untagged |
| `sha-abc1234` | One specific commit |

Images are built for `linux/amd64` and `linux/arm64` and carry a signed build
provenance attestation, which you can verify with:

```bash
gh attestation verify oci://ghcr.io/whoopsi-daisy/samband:latest \
  --repo whoopsi-daisy/samband
```

### Updating

Building from source:

```bash
git pull
docker compose up -d --build
```

Or, running the published image:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

The database lives in the bind-mounted `./data` directory, so rebuilds never
touch it.

### Backups

`events.db` is the entire state. Snapshot it safely while the app runs:

```bash
./scripts/export-db.sh ./data/events.db ./backup-$(date +%F).db
```

Do not just `cp` the file — the database runs in WAL mode, so recent writes live
in `events.db-wal` and a plain copy of the main file alone loses them.

## Importing the Brottsplatskartan archive

[Brottsplatskartan](https://brottsplatskartan.se/) publishes a free API covering
roughly **333,000 events** going back to 2016 — far more history than
polisen.se's API exposes, which only serves recent events. The importer pulls
that archive into the same SQLite database.

This is entirely opt-in. Nothing below runs unless you ask for it.

### Try it first

```bash
npm run import:bpk -- --probe
```

This makes one request and reports what the API says: how many events exist, how
many events come back per request, and therefore how many requests a full import
needs. It writes nothing.

### Running an import

```bash
# Only what is new since the last run — safe to run on a schedule
npm run import:bpk

# The whole archive. Takes a while; see the estimate below
npm run import:bpk -- --mode=full

# Tune it
npm run import:bpk -- --mode=full --concurrency=6 --max-pages=500
```

Progress is written to the database after every batch, so **Ctrl-C is safe** —
re-running with `--mode=full` continues from the last completed page rather than
starting over.

Inside a container, the same thing over HTTP (credentials are the
`STATS_USER`/`STATS_PASSWORD` pair):

```bash
# Status
curl -u admin:secret http://localhost:3000/api/import/brottsplatskartan

# Start
curl -u admin:secret -X POST -H 'content-type: application/json' \
  -d '{"mode":"full"}' http://localhost:3000/api/import/brottsplatskartan

# Stop (progress is kept)
curl -u admin:secret -X DELETE http://localhost:3000/api/import/brottsplatskartan
```

### On first boot

Set `BPK_IMPORT_ON_START` to start an import automatically when the container
comes up:

| Value | Behaviour |
|-------|-----------|
| unset | Nothing happens (default) |
| `incremental` | Pull what is new on every boot |
| `full` | Import the archive once, then behave as `incremental` on later boots |

A `full` setting does not re-import on every restart: if a full run already
completed it switches to an incremental sync, and if one was interrupted it
resumes from where it stopped.

| Variable | Default | Description |
|----------|---------|-------------|
| `BPK_IMPORT_ON_START` | unset | `full`, `incremental`, or unset |
| `BPK_IMPORT_CONCURRENCY` | `4` | Requests in flight, 1–8 |
| `BPK_API_BASE_URL` | the public API | Point at a mock or caching proxy |

### How long, and how much disk

The API defaults to 10 events per request, which would mean ~33,000 requests.
It also accepts a `limit` parameter, and the importer probes for the largest
page size the server actually honours — at 100 per page that drops to ~3,300
requests. Run `--probe` to see what you will get.

Concurrency defaults to **4**, not the 25 a naive dump would use. This is a free
API run by a small site, and four in flight with a short pause between batches
still finishes in a few hours. The importer honours `Retry-After`, backs off
exponentially on 429 and 5xx, and gives up immediately on a 404 rather than
hammering a dead page.

Expect roughly **300–350 MB** of database growth for the full archive, measured
from real API responses (~950 bytes of stored fields per event, plus indexes).

### Where the data goes

Imported events live in their own `bpk_events` table, **not** in `events`.

This matters: both sources number their events from 1, and `events.id` is a
primary key holding polisen.se's ids. Importing one into the other would
silently overwrite unrelated polisen events wherever the id spaces collide — and
they do. Keeping them apart also means an import can be dropped and redone
without touching the data the app collects itself.

```sql
CREATE TABLE bpk_events (
  id INTEGER PRIMARY KEY,      -- brottsplatskartan's id
  pubdate TEXT NOT NULL,       -- UTC ISO 8601, like every other timestamp here
  pubdate_unix INTEGER,
  title_type TEXT,             -- "Trafikbrott", "Brand", ...
  title_location TEXT,
  headline TEXT,
  description TEXT,
  content TEXT,                -- HTML, as served
  location_string TEXT,
  county TEXT,                 -- administrative_area_level_1
  lat REAL,
  lng REAL,
  external_source_link TEXT,   -- usually the polisen.se original
  permalink TEXT,
  imported_at TEXT NOT NULL
);
```

Dropped deliberately: `content_formatted` (byte-identical to `content` in the
responses checked), the map image URLs and viewport bounds (derivable from
`lat`/`lng`), and `date_human` (a rendered string). Everything with independent
information content is kept.

**These events are not shown in the app's UI.** The feed, map and statistics
still read only the polisen.se `events` table. Surfacing 333k archived events
means merging two different schemas into one timeline, with its own filtering
and deduplication design — a separate piece of work, deliberately not bundled
into the import.

### Caveats

- **Pagination drift.** The API paginates a live, newest-first feed, so page
  boundaries shift as events are published during a multi-hour run. Re-served
  events are ignored on insert, but a few can be skipped. Run an incremental
  sync afterwards to close the gap.
- **Duplication with polisen.se.** Brottsplatskartan largely republishes
  polisen.se, so recent events will exist in both tables in different shapes.
  The `external_source_link` column holds the polisen.se URL if you want to
  correlate them.
- Check the site's terms and be considerate with `BPK_IMPORT_CONCURRENCY`.

## Migrating an existing install into Docker

If you already run samband directly on a host (e.g. a Proxmox LXC container),
move the collected history across in three steps.

**1. Export on the old host.** This uses SQLite's online backup API, so the app
can keep running while it happens:

```bash
cd /path/to/samband          # wherever the app lives on the LXC
./scripts/export-db.sh
```

It prints a summary (event count, oldest/newest event, integrity check) and
writes `samband-export-<timestamp>.db`. If the `sqlite3` CLI is not installed,
the script falls back to the `better-sqlite3` module the app already ships, so
there is nothing to install.

**2. Copy it to the Docker host:**

```bash
scp samband-export-*.db user@docker-host:/path/to/samband/
```

**3. Import and start:**

```bash
cd /path/to/samband
docker compose down                        # if already running
sudo ./scripts/import-db.sh samband-export-20260727-143000.db
docker compose up -d --build
```

`import-db.sh` verifies the file is a real SQLite database, moves any existing
database aside as `events.db.bak-<timestamp>` rather than deleting it, clears
stale WAL sidecars that would otherwise be replayed over the new file, and sets
ownership to uid 1001 so the container can write to it.

### What happens on first start

Older databases stored `event_time` in two different shapes — UTC
(`2026-07-27T12:30:00.000Z`) and the API's local offset form
(`2026-07-27T14:30:00+02:00`). SQLite compares these columns as text, and those
two shapes do not sort against each other chronologically, so the feed order and
the "last 24h" statistics were both subtly wrong.

The app migrates these to UTC automatically on first start and logs what it did:

```
[db] migration: normalised 500 event timestamps to UTC
```

This runs once, tracked by `schema_version` in the `meta` table. Because it
rewrites rows in place, **take the export in step 1 before starting the
container** — that file is your rollback.

### Troubleshooting

| Symptom | Cause |
|---------|-------|
| `SQLITE_CANTOPEN` / `attempt to write a readonly database` | `./data` is not writable by uid 1001. Run `sudo chown -R 1001:1001 data`. |
| Event times off by 1–2 hours | `TZ` is not `Europe/Stockholm`. |
| Container `(unhealthy)` | `/api/health` returns 503 when the last fetch is over an hour old. Check `docker compose logs` for polisen.se errors. |
| Feed is empty on a fresh install | Backfill has not finished; wait a minute and check `/stats`. |

## Project Structure

```
samband/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root layout with metadata
│   │   ├── page.tsx            # Home page (Server Component)
│   │   ├── globals.css         # Global styles
│   │   ├── stats/              # Operational dashboard
│   │   │   └── page.tsx        # System status page
│   │   └── api/                # API Route Handlers
│   │       ├── events/         # GET /api/events
│   │       ├── details/        # GET /api/details
│   │       └── health/         # GET /api/health (container healthcheck)
│   │
│   ├── components/             # React Components
│   │   ├── ClientApp.tsx       # Main client-side wrapper
│   │   ├── EventCard.tsx       # Individual event card
│   │   ├── EventList.tsx       # Event grid with pagination
│   │   ├── EventMap.tsx        # Full map view (Leaflet)
│   │   ├── MapModal.tsx        # Single location map modal
│   │   ├── Filters.tsx         # Search and filter controls
│   │   ├── Header.tsx          # Sticky header with navigation
│   │   ├── StatsView.tsx       # Statistics dashboard
│   │   ├── OperationalDashboard.tsx  # System monitoring dashboard
│   │   ├── Footer.tsx          # Footer with event counts
│   │   ├── ScrollToTop.tsx     # Scroll to top button
│   │   └── ServiceWorkerRegistration.tsx  # PWA service worker
│   │
│   ├── hooks/                  # Custom React hooks
│   │   ├── useKeyboardShortcuts.ts  # Keyboard shortcut handling
│   │   ├── useMounted.ts       # Hydration-safe gate for clock/TZ-dependent UI
│   │   └── useNow.ts           # Shared one-minute clock for relative times
│   │
│   ├── lib/                    # Server-side utilities
│   │   ├── db.ts               # SQLite database operations
│   │   ├── policeApi.ts        # Police API client
│   │   ├── rateLimit.ts        # API rate limiting
│   │   └── utils.ts            # Formatting utilities
│   │
│   ├── __tests__/              # Test files
│   │   ├── utils.test.ts       # Utility function tests
│   │   └── htmlEntities.test.ts # HTML entity tests
│   │
│   └── types/                  # TypeScript definitions
│       └── index.ts            # Shared type definitions
│
├── public/                     # Static assets
│   ├── manifest.json           # PWA manifest
│   ├── icons/                  # App icons
│   └── sound/                  # Audio files
│
├── scripts/                    # Operational scripts
│   ├── export-db.sh            # Consistent DB snapshot (WAL-safe)
│   └── import-db.sh            # Import a snapshot into the Docker data dir
│
├── data/                       # Data directory (bind-mounted into the container)
│   └── events.db               # SQLite database (created at runtime)
│
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── next.config.js
└── README.md
```

## API Endpoints

### GET /api/events

Fetches paginated police events from the database.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `location` | string | Filter by location name |
| `type` | string | Filter by event type |
| `search` | string | Search in name, summary, location |

**Response:**
```json
{
  "events": [...],
  "hasMore": true,
  "total": 1234
}
```

### GET /api/details

Fetches detailed text content for a specific event from polisen.se.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Event URL path (e.g., `/aktuellt/handelser/...`) |

**Response:**
```json
{
  "success": true,
  "details": {
    "content": "Detailed event description..."
  }
}
```

### GET /api/health

Liveness probe used by the container healthcheck. Not rate limited, so a probe
can never lock itself out. Returns 503 when the last fetch attempt is older than
60 minutes, or when the database cannot be opened.

**Response:**
```json
{
  "status": "ok",
  "events": 12043,
  "lastFetch": "2026-07-27T16:08:32.813Z",
  "lastFetchAgeMinutes": 3
}
```

## Database Schema

The SQLite database stores events with the following structure:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  datetime TEXT,
  event_time TEXT,           -- When the event occurred
  publish_time TEXT,         -- When the event was published
  last_updated TEXT,         -- Last update timestamp
  name TEXT,
  summary TEXT,
  url TEXT,
  type TEXT,
  location_name TEXT,
  location_gps TEXT,
  raw_data TEXT,             -- Original JSON from API
  fetched_at TEXT,
  content_hash TEXT          -- For change detection
);

CREATE TABLE fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at TEXT,
  events_fetched INTEGER,
  events_new INTEGER,
  success INTEGER,
  error_message TEXT
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,        -- 'schema_version' tracks applied migrations
  value TEXT
);
```

All timestamp columns hold canonical UTC ISO 8601 (`2026-07-27T12:30:00.000Z`).
SQLite compares them as text, so a single shape is required for `ORDER BY` and
range filters to be chronologically correct — see the migration note above.
Statistics that are meaningful only in local time (events per hour, per weekday,
per day) apply SQLite's `'localtime'` modifier at query time.

## Configuration

### Environment Variables

No environment variables are required for basic operation, but `TZ` should
always be set — see the warning under Prerequisites.

| Variable | Default | Description |
|----------|---------|-------------|
| `TZ` | system | Process timezone. Must be `Europe/Stockholm`; event time parsing and the local-time statistics depend on it. Set in the image. |
| `SAMBAND_DATA_DIR` | `<cwd>/data` | Directory holding `events.db`. The standalone server runs from a different working directory than the repo root, so the image sets this to `/app/data`. |
| `RATE_LIMIT_PROXY_HOPS` | `1` | Number of trusted reverse-proxy hops in front of the app. The client IP is read this many positions from the right of `X-Forwarded-For`, so a client cannot spoof it. Set to the number of proxies (e.g. Traefik, a CDN) ahead of the container. |

### Background Refresh

The app refreshes events lazily on incoming requests, and an in-process
scheduler (`src/instrumentation.ts`) additionally refreshes every 10 minutes so
data stays current even with no traffic. The scheduler runs once per server
process; it relies on the database's last-fetch timestamp to avoid duplicate
fetches, and also prunes `fetch_log` entries older than 30 days.

### Cache Settings

| Setting | Value | Description |
|---------|-------|-------------|
| Page revalidation | 600s | How often Server Components refetch data |
| Police API cache | 600s | Minimum time between API calls |

### Rate Limiting

API endpoints are protected by in-memory rate limiting:
- 60 requests per minute per IP address
- Returns 429 status with `Retry-After` header when exceeded
- Includes `X-RateLimit-*` headers in responses
- State is per-process: this suits the single-container deployment. Running
  multiple replicas would give each its own counters — use a shared store
  (e.g. Redis) before scaling horizontally.

### Next.js Config

Key settings in `next.config.js`:
- Turbopack enabled (default in Next.js 16)
- Security headers (X-Frame-Options, CSP, etc.)
- Leaflet transpilation and CSS handling
- Client-side webpack fallbacks for `fs`, `path`, `crypto`

## Views

### List View (Default)
Displays events in a card-based grid layout with:
- Event type badge with color coding
- Location and timestamp
- Summary text
- Expandable details (lazy-loaded)
- Map link for events with GPS coordinates

### Map View
Interactive Leaflet map showing:
- Events from the last 24 hours
- Color-coded markers by event type
- Popup with event details and links
- Event count indicator

### Statistics View
Dashboard with:
- Key metrics (total, 24h, 7d, 30d counts)
- 7-day trend chart
- Events by weekday
- Hourly distribution (last 24h)
- Top event types
- Top locations

### Operational Dashboard (/stats)
Hidden system monitoring page at `/stats` with:
- System health overview (uptime, success rate, data freshness)
- Fetch operation statistics (total, successful, failed)
- Hourly fetch chart (24h)
- Database health metrics (total events, locations, event types)
- Data coverage (oldest/newest events, GPS coverage)
- Recent error log
- Recent fetch log table

## Event Types

Events are color-coded by type:

| Type | Color | Icon |
|------|-------|------|
| Inbrott (Burglary) | Orange | 🔓 |
| Brand (Fire) | Red | 🔥 |
| Rån (Robbery) | Amber | 💰 |
| Trafikolycka (Traffic) | Blue | 🚗 |
| Misshandel (Assault) | Red | 👊 |
| Narkotikabrott (Drugs) | Green | 💊 |
| Bedrägeri (Fraud) | Purple | 🕵️ |
| Skadegörelse (Vandalism) | Amber | 🔨 |
| Stöld (Theft) | Orange | 🔓 |
| Stöld/inbrott | Orange | 🔓 |
| Mord/dråp (Murder) | Dark Red | ⚠️ |
| Ofredande (Harassment) | Rose | 🚨 |
| Rattfylleri (DUI) | Red | 🚗 |
| Sammanfattning (Summary) | Green | 📊 |
| Default | Yellow | 📌 |

## PWA Features

The application is a Progressive Web App with:
- Installable on desktop and mobile
- Offline-capable manifest
- App shortcuts for Map and Statistics views
- Custom app icon

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `1` | Switch to List view |
| `2` | Switch to Map view |
| `3` | Switch to Statistics view |
| `/` or `Ctrl+K` | Focus search input |
| `Escape` | Close modals, clear focus |
| `t` or `Home` | Scroll to top |

## Development

### Running in Development

```bash
npm run dev
```

The development server runs on port 3000 with hot reload.

### Linting

```bash
npm run lint
```

### Testing

```bash
npm run test           # Run tests once
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
```

### Type Checking

TypeScript errors are checked during build:
```bash
npm run build
```

### Publishing a release

`.github/workflows/publish.yml` builds the image and pushes it to
`ghcr.io/<owner>/<repo>`. It runs on every push to `main` (publishing `edge`)
and on every `v*.*.*` tag (publishing the semver tags and `latest`). Pull
requests are not published — `ci.yml` builds the same Dockerfile and smoke-tests
it without pushing.

To cut a release:

```bash
npm version 1.2.0 --no-git-tag-version   # keep package.json in step
git commit -am "Release 1.2.0"
git tag v1.2.0
git push origin main --tags
```

A pre-release tag (`v1.2.0-rc.1`) publishes only that exact version — it does
not move `latest`, `1.2`, or `1`.

The workflow authenticates with the automatically provided `GITHUB_TOKEN`; no
personal access token or secret needs to be created. It does need these
permissions, which are declared in the workflow itself:

| Permission | Why |
|------------|-----|
| `contents: read` | Check out the repository |
| `packages: write` | Push to ghcr.io — without it the push fails with `denied: installation not allowed` |
| `id-token: write` | Mint the OIDC token that signs the provenance attestation |
| `attestations: write` | Record that attestation against the repository |

**Two things must be set in the repository settings by hand** — a workflow
cannot grant itself either:

1. **Settings → Actions → General → Workflow permissions** must not be set to
   a mode that strips `packages: write`. "Read repository contents and
   packages permissions" is fine, because the workflow requests what it needs
   explicitly.
2. **The package's visibility.** The first successful push creates the package
   as *private*, inheriting from the repository. To let anyone `docker pull`
   without authenticating, go to the package page → *Package settings* →
   *Change visibility* → **Public**. This is a one-time step; later pushes keep
   whatever visibility the package already has.

If you would rather keep the image private, consumers authenticate with a token
that has `read:packages`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <username> --password-stdin
```

Note that `arm64` is built under QEMU emulation, which dominates the workflow's
runtime. If you only deploy to x86 hosts, run the workflow manually with
`platforms: linux/amd64`, or change the default in the workflow file.

### Dependency overrides

`package.json` pins `postcss` and `sharp` above the versions Next.js depends on;
both of Next's pins carry high-severity advisories, and `npm audit fix` would
otherwise "resolve" them by downgrading Next.js to 9.x. Production dependencies
audit clean; drop the overrides once Next ships updated pins.

One high-severity advisory remains in the dev-only lint toolchain
(`brace-expansion`, reached through `eslint`). It never runs in production, and
its only available fix downgrades `@eslint/eslintrc` to 0.1.0. CI therefore
audits with `--omit=dev`.

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        User Request                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Server Component (page.tsx)                │
│  - Checks if data refresh needed (every 10 min)              │
│  - Fetches from Police API if stale                          │
│  - Queries SQLite database                                   │
│  - Formats events for UI                                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Client Component (ClientApp.tsx)            │
│  - Handles view switching                                    │
│  - Manages UI state (filters, modals)                       │
│  - Renders appropriate view component                        │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ EventList│   │ EventMap │   │StatsView │
        └──────────┘   └──────────┘   └──────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Routes (on demand)                    │
│  - /api/events - Pagination                                  │
│  - /api/details - Lazy-load event details                   │
└─────────────────────────────────────────────────────────────┘
```

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## License

This project fetches data from public APIs. Please respect the terms of service of [Polisen.se](https://polisen.se).

## Acknowledgments

- Swedish Police for the public events API
- OpenStreetMap contributors
- CartoDB for the dark map theme
- Leaflet.js for mapping
