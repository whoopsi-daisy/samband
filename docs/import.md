# Importing the Brottsplatskartan archive

[Brottsplatskartan](https://brottsplatskartan.se/) publishes a free API covering
roughly **333,000 events** going back to 2016 — far more history than
polisen.se's API exposes, which only serves recent events. The importer pulls
that archive into the same SQLite database, into its own `bpk_events` table.

Entirely opt-in: nothing here runs unless you ask for it.

There are two sources and three places to drive them from.

| Source | What it does | Cost |
|--------|--------------|------|
| **NDJSON dump** | Reads a file (or URL) of one event per line | Minutes, no load on anyone's API |
| **API, incremental** | Pulls everything newer than what is stored | Seconds to minutes |
| **API, full** | Walks the whole archive page by page | Hours, ~670 requests |

| Driven from | Good for |
|-------------|----------|
| **`/stats` dashboard** | The normal way. Live progress, start and cancel buttons |
| **`BPK_IMPORT_ON_START`** | Unattended: seed on first boot, stay current on later ones |
| **`npm run import:bpk`** | A source checkout — the CLI is not in the container image |

## The dump route (recommended)

A dump is one event per line, each line exactly as the API's `data[]` entries
are shaped — the output of a mirroring script that paginated
`brottsplatskartan.se/api/events?limit=500&page=N` and wrote every element of
`data` as its own line. Extra fields are welcome: teasers, viewport corners and
map image URLs are read and discarded, and the applicable fields are stored (see
[what is kept](#what-is-kept)).

Put the dump next to the database, in the data directory the container mounts:

```bash
cd /opt/samband
cp ~/brottsplatskartan.ndjson data/
chmod 644 data/brottsplatskartan.ndjson   # uid 1001 only needs to read it
```

Then either start it from **/stats** — the panel lists dumps it finds in the
data directory — or over HTTP:

```bash
curl -u admin:secret -X POST -H 'content-type: application/json' \
  -d '{"mode":"ndjson","source":"brottsplatskartan.ndjson"}' \
  http://localhost:3000/api/import/brottsplatskartan
```

A bare name is resolved inside the data directory. An `http(s)` URL is streamed
instead of a file:

```json
{"mode":"ndjson","source":"https://example.com/brottsplatskartan.ndjson"}
```

Requests may only name files **inside the data directory** — mount the dump
there rather than pointing at an arbitrary path. The CLI and
`BPK_IMPORT_SOURCE`, which are operator-controlled, accept any readable path.

Expect roughly **15,000 events a second** from a local file: a 333k-event, ~700
MB dump lands in well under a minute. The file is streamed line by line, so its
size never matters. Corrupt or truncated lines are counted and skipped rather
than aborting the run, and re-running is free — nothing already stored is
written again.

Afterwards, keep it current from the API:

```bash
curl -u admin:secret -X POST -H 'content-type: application/json' \
  -d '{"mode":"incremental"}' http://localhost:3000/api/import/brottsplatskartan
```

### Seeding a fresh container from a dump

Put the dump in `./data`, then in `.env`:

```bash
BPK_IMPORT_ON_START=ndjson
BPK_IMPORT_SOURCE=brottsplatskartan.ndjson
```

On the first boot with an empty archive it loads the dump. On every later boot
it sees events already stored and runs an incremental sync instead, so the
archive stays current without re-reading the file.

## Watching an import

This is the part worth knowing: an import is observable while it runs, from
three places.

**The `/stats` dashboard.** A live panel with a progress bar, percentage, rows
imported, duplicates, skipped lines, throughput, ETA and a log tail. It streams
over server-sent events, so it moves without reloading, and falls back to
polling if the stream cannot be held open. It is also where you start and
cancel runs.

**The stream, directly.** Every message is a full snapshot, so a watcher that
connects mid-import is immediately up to date:

```bash
curl -N -u admin:secret http://localhost:3000/api/import/brottsplatskartan/stream
```

```
data: {"state":{"status":"running",...},"running":true,"progress":{"mode":"ndjson",
"source":"brottsplatskartan.ndjson","percent":42.5,"imported":142000,"duplicates":0,
"skipped":2,"linesRead":142000,"bytesRead":189000000,"bytesTotal":447350065,
"perSecond":15300,"etaSeconds":17,...},"log":[...]}
```

**The container log.** One line every 15 seconds, plus a start and a finish
line:

```
docker compose logs -f
[bpk] dump import started from brottsplatskartan.ndjson
[bpk] dump brottsplatskartan.ndjson: 142 000 lines (42.5%), 142 000 new, 0 already known
[bpk] dump import finished in 22s: 333 478 new, 0 already known, 2 skipped, 333 478 stored in total
```

A single poll, if you would rather not hold a connection open:

```bash
curl -s -u admin:secret http://localhost:3000/api/import/brottsplatskartan | jq
```

## The API route

If you have no dump, the importer can walk the API itself.

```bash
# What the API says exists, and how many requests a full import needs.
# Writes nothing.
npm run import:bpk -- --probe

# Only what is new since the last run — safe on a schedule
npm run import:bpk

# The whole archive
npm run import:bpk -- --mode=full
npm run import:bpk -- --mode=full --concurrency=6 --max-pages=500
```

Or over HTTP: `{"mode":"full","concurrency":6}`.

Progress is written to the database after every batch, so **Ctrl-C and
container restarts are safe** — a full run resumes from the last completed page
rather than starting over. `DELETE /api/import/brottsplatskartan` cancels a
running import the same way.

**How long.** The API defaults to 10 events per request, which would mean
~33,000 requests. It also accepts `limit=500`, confirmed working against the
live API, bringing a full import down to roughly **670 requests**. The importer
asks for 500 and then believes whatever the server actually returns, so a future
cap degrades gracefully. Concurrency defaults to **4**, not the 25 a naive
importer would use: this is a free API run by a small site, and four in flight
with a short pause between batches still finishes in a few hours. It honours
`Retry-After`, backs off exponentially on 429 and 5xx, and gives up immediately
on a 404 rather than hammering a dead page.

Expect roughly **300–350 MB** of database growth for the full archive (~950
bytes of stored fields per event, plus indexes).

## The CLI

Only available in a source checkout — the container image ships the server, not
the scripts.

```bash
npm run import:bpk -- --from-ndjson=brottsplatskartan.ndjson   # in the data dir
npm run import:bpk -- --from-ndjson=/mnt/backup/bpk.ndjson     # anywhere
npm run import:bpk -- --from-ndjson=https://example.com/bpk.ndjson
npm run import:bpk -- --probe
npm run import:bpk -- --mode=incremental
npm run import:bpk -- --mode=full --concurrency=6
```

`SAMBAND_DATA_DIR` selects the database, exactly as it does for the app.
Progress prints live — a meter that rewrites itself on a terminal, periodic
lines when redirected to a file:

```
   42.5% 189.4 MB/426.6 MB, 142 000 lines, 142 000 new, 0 known ETA 17s

Finished.
  source      brottsplatskartan.ndjson
  lines read  333 478
  imported    333 478
  already had 0
  elapsed     22s
  stored now  333 478
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BPK_IMPORT_ON_START` | unset | `ndjson`, `full`, `incremental`, or unset for no import |
| `BPK_IMPORT_SOURCE` | unset | Dump path or URL for `ndjson`. A bare name is read from the data directory |
| `BPK_IMPORT_CONCURRENCY` | `4` | Requests in flight for an API walk, 1–8 |
| `BPK_API_BASE_URL` | the public API | Point at a mock or a caching proxy |

`full` and `ndjson` seed once: if the archive already holds events (or a full
run already completed), the next boot runs an incremental sync instead. An
interrupted full run resumes from where it stopped.

## What is kept

Imported events live in their own `bpk_events` table, **not** in `events`.

Both sources number their events from 1, and `events.id` is a primary key
holding polisen.se's ids. Importing one into the other would silently overwrite
unrelated polisen events wherever the id spaces collide — and they do. Keeping
them apart also means an import can be dropped and redone without touching the
data the app collects itself.

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

Dropped deliberately, whether they arrive from the API or from a dump:
`content_formatted` (byte-identical to `content` in the responses checked),
`content_teaser` (a truncation of `content`), `location_string_2` (a prefix of
`location_string`), the map image URLs and viewport corners (derivable from
`lat`/`lng`), and `date_human` ("4 timmar sedan" — a rendered string that is
wrong the moment it is stored). Everything with independent information content
is kept. Records without a usable id or date are skipped rather than stored
half-formed.

Legacy records that carry `parsed_date` ("2016-10-14 21:27:00", Swedish local
time) instead of `pubdate_iso8601` are handled — that is most of the older
archive.

## How the app reads it

Imported events are part of the dataset the moment an import finishes. The
feed, the map, the search, the filter dropdowns and the statistics all read
`bpk_events` alongside `events`, and the caches those views are served from are
rebuilt as the import ends rather than expiring in their own time.

**The two sources overlap.** Brottsplatskartan republishes polisen.se, so any
period the live feed covers exists in both tables. The rule is a single cutoff:
the oldest event the live feed holds. Live data wins from there forward, the
archive supplies everything before it. So a 2016–today dump behind a feed that
reaches back three months contributes 2016 → three months ago, and nothing is
counted twice.

The cutoff is shown in the statistics view, under the headline numbers:

> Data från 2016-03-11 och framåt. Inkluderar 331 402 importerade händelser
> från Brottsplatskartan fram till 2026-04-28, därefter polisens egen
> händelseström.

What that rule trades away: if the app was down for a stretch inside the live
window, the archive does not fill that gap — the cutoff is a single point in
time, not a per-day check. Re-importing does not change it. The alternative,
matching individual incidents across two schemas, is guesswork on exactly the
rows where it matters.

Two details of how archived rows are presented:

- **Negative ids.** Both sources number their events from 1, so archived rows
  are projected with the sign flipped. Nothing in the UI collides.
- **Detail text.** Expanding an archived event shows the `content` the import
  stored, served straight from the database. It deliberately does not fetch
  polisen.se: those pages are removed after a while, so for anything but the
  most recent events that fetch comes back empty — precisely when someone is
  reading the archive rather than the live feed. The polisen.se link is still
  offered on the card for events whose page is still up.

### Searching it

Search runs on an FTS5 index over the imported events, rebuilt as part of the
schema migration and kept in step by the importer as it writes. Two things
follow from that:

- **The event body is searchable.** The old search scanned every row and could
  only afford to look at the headline, the summary and the location. A street
  name mentioned only in the text of a 2019 incident is now findable.
- **It is fast.** Single-digit milliseconds for an ordinary term, against
  160–225 ms of scanning before, on a 333k-event archive.

The tokenizer is the one decision worth knowing about. `BPK_SEARCH_TOKENIZER`
defaults to `trigram`, which matches substrings the way the old scan did —
searching `guldsmed` finds `guldsmedsaffär`, which matters constantly in
Swedish. It costs about 350 MB of index for a full archive. Setting it to
`unicode61` cuts that to ~55 MB and matches whole words and prefixes instead,
so mid-compound searches stop finding anything. Changing the value rebuilds the
index on the next start, which takes about 20 seconds per 333k events.

Two edges: a one- or two-character search has no trigram to look up and falls
back to the old scan, and a term that matches a large fraction of the archive
is bounded by sorting those matches by date rather than by the index — around
200 ms for a term hitting 50k events, which is still no worse than the scan it
replaced.

Statistics over a large archive are computed once and cached; the refresh
scheduler and the importer both rebuild them off the request path, so a page
view does not wait for a scan of the whole archive.

## Does a full API import really get everything?

That is the whole point of a full import, so here is exactly how it behaves
against a feed that keeps moving.

The API paginates a **live, newest-first** list, and events keep being published
during a run that takes hours. The importer walks pages in **ascending** order,
which is the direction that makes this safe:

- New events are inserted at the head, so every existing event moves toward
  **later** pages — away from the cursor. An event can never slip behind it.
- The cost is re-reading events already stored. `INSERT OR IGNORE` absorbs
  those, which is why a run reports a large "already had" count.

Two things were needed to make "everything" actually true, both covered by tests
that run against an archive which grows mid-import:

- **The end of the archive moves.** As events are added, the oldest ones are
  pushed onto page numbers past whatever the last page was when the run started.
  Fixing that bound at the start silently drops them — and an incremental sync
  can never recover them, because it stops at its watermark and these are the
  oldest events there are. The bound is therefore re-read from every response,
  and re-checked once more after the walk appears finished.
- **The cursor advances by what was fetched**, not by a fixed batch stride. A
  batch clamped by the current last page (or by `--max-pages`) would otherwise
  leave a hole where the stride overshot.

If the feed ever grew faster than it could be read, the run stops at a ceiling
and reports itself incomplete rather than chasing forever. Re-running resumes.

**Verifying a run.** The CLI and the API both report coverage against the API's
own event count:

```
  stored now  333 478
  API reports 333 478 events -> 100.00% coverage
```

```bash
curl -s -u admin:secret http://localhost:3000/api/import/brottsplatskartan \
  | jq '{stored: .state.storedEvents, reported: .state.totalEvents, coverage: .coveragePercent}'
```

A small shortfall is possible and harmless: records the API serves without a
usable id or date are skipped. Re-running `--mode=full` sweeps again — if the
number does not move, the archive is fully read. It is safe to re-run at any
time; it stores nothing it already has.

Coverage is `null` after a dump import until an API run reports a total: a dump
cannot say how much of the archive it contains, and claiming 100% would be a
guess.

## The realtime feed keeps running

Importing the archive does not change how the app collects data. The polisen.se
refresh keeps running on its 10-minute schedule throughout, writing to `events`,
completely independently of `bpk_events`. Tests cover this: polisen events are
written and read while an import is in flight, and a completed import leaves the
`events` table byte-identical.

## Other caveats

- **Duplication with polisen.se.** Brottsplatskartan largely republishes
  polisen.se, so recent events exist in both tables in different shapes. The
  `external_source_link` column holds the polisen.se URL if you want to
  correlate them.
- **Deep pagination.** Request ~670 is a large `OFFSET`. If the API slows down
  or starts failing that deep, the importer retries with backoff and, failing
  that, stops with progress saved so a later run continues. Not exercised
  against the live API at that depth.
- **One import at a time.** Starting a second returns `409` while one runs.
- Check the site's terms and be considerate with `BPK_IMPORT_CONCURRENCY`.

## HTTP reference

All four are behind `STATS_USER`/`STATS_PASSWORD` when those are set.

| Method | Path | Does |
|--------|------|------|
| `GET` | `/api/import/brottsplatskartan` | Status, live counters, log tail, dumps found in the data directory |
| `GET` | `/api/import/brottsplatskartan/stream` | The same snapshot, pushed as server-sent events |
| `POST` | `/api/import/brottsplatskartan` | Start: `{"mode":"ndjson","source":"..."}`, `{"mode":"incremental"}`, `{"mode":"full","concurrency":6}` |
| `DELETE` | `/api/import/brottsplatskartan` | Cancel the running import; progress is kept |

`POST` answers `202` with `{started, mode, source}`, `400` for a bad mode or an
unusable source, and `409` if an import is already running.
