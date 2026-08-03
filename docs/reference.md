# Reference

Details that are useful once, then rarely: HTTP endpoints, the database schema,
what each view shows, and the configuration knobs the app reads.

## HTTP endpoints

### GET /api/events

Paginated police events from the database.

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `location` | string | Filter by location name |
| `type` | string | Filter by event type |
| `search` | string | Search in name, summary, location |

```json
{ "events": [], "hasMore": true, "total": 1234 }
```

### GET /api/details

The body text of one event. Live events are fetched from polisen.se on demand;
imported ones are served from the text the import stored, without touching the
network: see [import.md](import.md#how-the-app-reads-it).

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | number | Event id. A negative id is an imported event and is answered from the database |
| `url` | string | Event URL path (e.g. `/aktuellt/handelser/...`), used for live events |

```json
{ "success": true, "details": { "content": "..." } }
```

### GET /api/health

Liveness probe used by the container healthcheck. Not rate limited, so a probe
can never lock itself out. Returns 503 when the last fetch attempt is older than
60 minutes, or when the database cannot be opened.

```json
{
  "status": "ok",
  "events": 12043,
  "lastFetch": "2026-07-27T16:08:32.813Z",
  "lastFetchAgeMinutes": 3
}
```

### GET /api/map

Coordinates for the map view.

### /api/import/brottsplatskartan

Import control and live progress. Covered in [import.md](import.md#http-reference).

## Database schema

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  datetime TEXT,
  event_time TEXT,           -- When the event occurred
  publish_time TEXT,         -- When the event was published
  last_updated TEXT,
  name TEXT,
  summary TEXT,
  url TEXT,
  type TEXT,
  location_name TEXT,
  location_gps TEXT,
  raw_data TEXT,             -- Original JSON from the API
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
  key TEXT PRIMARY KEY,      -- 'schema_version' tracks applied migrations
  value TEXT
);
```

`bpk_events` and `bpk_import_state` are described in
[import.md](import.md#what-is-kept). The app's own queries read that table
alongside `events`: see [how the app reads it](import.md#how-the-app-reads-it)
for the rule that keeps the overlapping period from being counted twice.

All timestamp columns hold canonical UTC ISO 8601
(`2026-07-27T12:30:00.000Z`). SQLite compares them as text, so a single shape is
required for `ORDER BY` and range filters to be chronologically correct.
Statistics that are meaningful only in local time (events per hour, per weekday,
per day) apply SQLite's `'localtime'` modifier at query time.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TZ` | system | Process timezone. Must be `Europe/Stockholm`; event time parsing and local-time statistics depend on it. Set in the image |
| `SAMBAND_DATA_DIR` | `<cwd>/data` | Directory holding `events.db` and any NDJSON dump. The image sets `/app/data` |
| `SITE_URL` | a built-in default | The address this deployment answers on. Used for the Open Graph image, the canonical link, `robots.txt` and the sitemap. Unset on a custom domain means link previews point at the wrong host; the container warns at startup |
| `RATE_LIMIT_PROXY_HOPS` | `1` | Trusted reverse-proxy hops. The client IP is read this many positions from the right of `X-Forwarded-For`, so a client cannot spoof it |
| `STATS_USER` / `STATS_PASSWORD` | unset | Both set fixes the HTTP Basic login for `/stats` and the import API at deploy time, and takes precedence over an account created at `/stats/setup`. Unset sends the first visitor to that setup page |
| `ADMIN_SETUP_OPEN` | unset | `true` drops the installation key `/stats/setup` asks for. Only for a deployment nothing else can reach while you set it up |
| `STATS_PUBLIC` | unset | `true` leaves `/stats` and the import API reachable with no login at all. Ignored once an account exists |
| `BPK_IMPORT_ON_START` | unset | `ndjson`, `full`, `incremental`. See [import.md](import.md) |
| `BPK_IMPORT_SOURCE` | unset | Dump path or URL for `ndjson` |
| `BPK_IMPORT_CONCURRENCY` | `4` | Requests in flight for an API walk, 1–8 |
| `BPK_API_BASE_URL` | the public API | Point the importer at a mock or a caching proxy |
| `BPK_SEARCH_TOKENIZER` | `trigram` | How the archive's full-text index tokenises. `trigram` matches substrings, including inside Swedish compounds (~350 MB for a full archive); `unicode61` matches words and prefixes for ~55 MB. Changing it rebuilds the index on the next start. See [import.md](import.md#searching-it) |

### Background refresh

The app refreshes events lazily on incoming requests, and an in-process
scheduler (`src/instrumentation.ts`) additionally refreshes every 10 minutes so
data stays current with no traffic. It runs once per server process, relies on
the database's last-fetch timestamp to avoid duplicate fetches, and prunes
`fetch_log` entries older than 30 days.

### Caching and rate limiting

| Setting | Value |
|---------|-------|
| Page revalidation | 600s |
| Police API cache | 600s |
| Rate limit | 60 requests/minute/IP, `429` with `Retry-After` |

Rate-limit state is per-process, which suits the single-container deployment.
Multiple replicas would each get their own counters: use a shared store before
scaling horizontally.

### Next.js config

`next.config.js` carries the security headers (X-Frame-Options, CSP), Leaflet
transpilation and CSS handling, and client-side fallbacks for `fs`, `path` and
`crypto`.

## Views

**List** (default): cards with a colour-coded type badge, location, timestamp,
summary, lazy-loaded details, and a map link when the event has coordinates.

**Map**: Leaflet map of the last 24 hours, markers coloured by type, popups
with details and links.

**Statistics**: totals (24h/7d/30d), a 7-day trend, events by weekday, hourly
distribution, top types and top locations, over the whole dataset: the live
feed plus every imported event older than the feed reaches. A line under the
headline numbers names that boundary. See [import.md](import.md#how-the-app-reads-it).

**Operational dashboard** (`/stats`): system health (uptime, success rate, data
freshness), fetch statistics and hourly chart, live import panel, database
health, data coverage, recent errors and the fetch log.

## Event types

| Type | Colour | Icon |
|------|--------|------|
| Inbrott | Orange | 🔓 |
| Brand | Red | 🔥 |
| Rån | Amber | 💰 |
| Trafikolycka | Blue | 🚗 |
| Misshandel | Red | 👊 |
| Narkotikabrott | Green | 💊 |
| Bedrägeri | Purple | 🕵️ |
| Skadegörelse | Amber | 🔨 |
| Stöld, Stöld/inbrott | Orange | 🔓 |
| Mord/dråp | Dark red | ⚠️ |
| Ofredande | Rose | 🚨 |
| Rattfylleri | Red | 🚗 |
| Sammanfattning | Green | 📊 |
| Default | Yellow | 📌 |

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `1` / `2` / `3` | List / Map / Statistics view |
| `/` or `Ctrl+K` | Focus search |
| `Escape` | Close modals, clear focus |
| `t` or `Home` | Scroll to top |

## PWA

Installable on desktop and mobile, offline-capable manifest, app shortcuts for
the Map and Statistics views.

## Dependency overrides

`package.json` pins `postcss` and `sharp` above the versions Next.js depends on;
both of Next's pins carry high-severity advisories, and `npm audit fix` would
otherwise "resolve" them by downgrading Next.js to 9.x. Production dependencies
audit clean; drop the overrides once Next ships updated pins.

One high-severity advisory remains in the dev-only lint toolchain
(`brace-expansion`, reached through `eslint`). It never runs in production, and
its only available fix downgrades `@eslint/eslintrc` to 0.1.0. CI therefore
audits with `--omit=dev`.
