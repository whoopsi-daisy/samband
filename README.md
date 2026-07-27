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
   git clone https://github.com/whoopsi-daisy/samband.git
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
git clone https://github.com/whoopsi-daisy/samband.git
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

---

# Deploying from GHCR

Two separate things, in order:

- **[Part A — publishing](#part-a--publish-images-from-your-repository)**: a
  one-time setup on GitHub so the workflow can push images. You do this once.
- **[Part B — deploying](#part-b--run-the-published-image)**: pulling and
  running that image on your server. You do this every time you deploy.

If someone else already publishes the image, skip to Part B.

## Part A — publish images from your repository

The workflow is already in the repo at `.github/workflows/publish.yml`. It needs
two things enabled on GitHub that a workflow cannot grant itself.

### A1. Check the workflow is there

```bash
ls .github/workflows/
# ci.yml  publish.yml
```

| File | Runs on | Does |
|------|---------|------|
| `ci.yml` | every push and PR | lint, typecheck, test, `npm run build`, plus a Docker build + `/api/health` smoke test. **Never pushes an image.** |
| `publish.yml` | pushes to `main`, `v*.*.*` tags, manual dispatch | builds and **pushes to ghcr.io** |

### A2. Allow Actions to write packages

GitHub → your repo → **Settings** → **Actions** → **General** → scroll to
**Workflow permissions**.

Select **"Read and write permissions"**, or leave it on read-only — either
works, because `publish.yml` requests what it needs explicitly:

```yaml
permissions:
  contents: read        # check out the repo
  packages: write       # push to ghcr.io
  id-token: write       # sign the provenance attestation
  attestations: write   # record it against the repo
```

What breaks this is an **organisation** policy that caps workflow permissions
below `packages: write`. If your repo is under an org and the push fails with
`denied: installation not allowed`, that cap is the reason — an org owner has to
lift it under Organisation Settings → Actions → General.

No secret needs creating. The workflow logs in with the `GITHUB_TOKEN` that
Actions injects automatically:

```yaml
- name: Log in to ghcr.io
  uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

### A3. Trigger the first publish

Merging this branch to `main` is enough — that publishes `:edge`. To publish a
real release:

```bash
npm version 1.0.0 --no-git-tag-version   # keeps package.json in step
git commit -am "Release 1.0.0"
git tag v1.0.0
git push origin main --tags
```

Watch it under the repo's **Actions** tab → *Publish container image*. The run
ends with a summary listing every tag it pushed and the image digest.

**The first run takes 15–25 minutes.** `arm64` is built under QEMU emulation and
the Next.js build dominates. Later runs hit the layer cache and are much faster.
If you only deploy to x86, see [A6](#a6-skipping-arm64).

### A4. Make the package public

**This is the step people miss.** The first successful push creates the package
as **private**, regardless of whether the repository is public. Until you change
it, `docker pull` fails with `denied` or `manifest unknown` for everyone
including you-on-another-machine.

GitHub → your **profile or org** page → **Packages** tab → click **samband** →
**Package settings** (right-hand side) → scroll to **Danger Zone** →
**Change package visibility** → **Public** → confirm by typing the package name.

Do this once. Later pushes keep whatever visibility the package already has.

While you are there, under **Manage Actions access**, confirm the `samband`
repository is listed with at least **Write** — that link is created
automatically on the first push, but it is worth a glance if pushes later start
failing.

### A5. Verify it worked

```bash
# From any machine, with no login at all:
docker pull ghcr.io/whoopsi-daisy/samband:latest
```

If that succeeds, Part A is done.

### A6. Skipping arm64

If everything you run is x86, halve the build time. Either run the workflow
manually — **Actions** → *Publish container image* → **Run workflow** → set
**Platforms** to `linux/amd64` — or make it permanent by editing the default in
`.github/workflows/publish.yml`:

```yaml
platforms: ${{ inputs.platforms || 'linux/amd64' }}
```

### A7. Keeping the image private instead

Skip A4 and have each server authenticate. Create a token at **Settings** →
**Developer settings** → **Personal access tokens** → **Tokens (classic)** with
only the **`read:packages`** scope, then on the server:

```bash
echo "ghp_yourtoken" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

The login persists in `~/.docker/config.json`, so `docker compose pull` works
from then on.

## Part B — run the published image

This is what you do on the Proxmox host, the LXC container, or wherever Docker
lives. Nothing here needs the source repository except the two compose files.

### B1. Prerequisites

```bash
docker --version          # 20.10+
docker compose version    # v2 — note: "docker compose", not "docker-compose"
```

### B2. Create the deployment directory

```bash
mkdir -p /opt/samband && cd /opt/samband
```

Fetch just the compose file:

```bash
curl -fsSLO https://raw.githubusercontent.com/whoopsi-daisy/samband/main/docker-compose.ghcr.yml
```

### B3. Create the data directory with the right owner

**Do this before the first start.** The container runs as an unprivileged user,
uid **1001**. If Docker creates `./data` itself it will be owned by root and the
app cannot write to it:

```bash
mkdir -p data
sudo chown -R 1001:1001 data
```

Symptom if you skip it: the container starts, then logs
`SQLITE_CANTOPEN: unable to open database file` and `/api/health` returns 503.

### B4. Configure

Create a `.env` file next to the compose file. Every value has a working
default, so an empty file is valid — but you almost certainly want the first
two:

```bash
cat > .env <<'EOF'
# Host port to publish on
SAMBAND_PORT=3000

# Credentials for the /stats dashboard and the import API.
# Leave unset and /stats is reachable by anyone who guesses the URL.
STATS_USER=admin
STATS_PASSWORD=change-me

# Pin a release for reproducible deploys; omit to follow `latest`.
# SAMBAND_TAG=1.0.0

# Number of reverse proxies in front of the app (see B7).
RATE_LIMIT_PROXY_HOPS=1

# Do NOT change TZ. The app parses Swedish wall-clock times out of event
# text and renders them back; anything else shifts every event by 1-2 hours.
TZ=Europe/Stockholm
EOF
chmod 600 .env
```

### B5. Start it

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

Then confirm it is actually healthy, not merely running:

```bash
docker compose -f docker-compose.ghcr.yml ps
```

```
NAME       IMAGE                                    STATUS
samband    ghcr.io/whoopsi-daisy/samband:latest     Up 2 minutes (healthy)
```

`(healthy)` is the bit that matters — it means `/api/health` is answering. It
takes up to 40 seconds to appear (the healthcheck's start period).

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","events":0,"lastFetch":"...","lastFetchAgeMinutes":0}
```

`events: 0` on a fresh install is expected. The first fetch backfills about a
week from polisen.se; give it a minute, then reload.

Follow the logs if anything looks wrong:

```bash
docker compose -f docker-compose.ghcr.yml logs -f
```

### B6. Choosing a tag

`docker-compose.ghcr.yml` reads `SAMBAND_TAG`, defaulting to `latest`.

| Tag | Points at | Use when |
|-----|-----------|----------|
| `latest` | Newest stable release | You want releases without thinking about it |
| `1.2.3` | That exact release | Production — reproducible, no surprise upgrades |
| `1.2` | Newest patch of 1.2 | You want bug fixes but not new features |
| `1` | Newest minor of 1.x | You accept features, not breaking changes |
| `edge` | Newest commit on `main` | You want unreleased changes and accept breakage |
| `sha-abc1234` | One specific commit | Bisecting a regression |

`latest` only ever moves on a real release. A pre-release tag like `v1.3.0-rc.1`
publishes only `1.3.0-rc.1` and never touches `latest`, `1.3` or `1`.

### B7. Behind a reverse proxy

Rate limiting reads the client IP from `X-Forwarded-For`, counting
`RATE_LIMIT_PROXY_HOPS` entries **from the right** — the entries your own
proxies appended, which a client cannot forge. Set it to the number of proxies
in front of the app: `1` for a single nginx/Traefik/Caddy, `2` if Cloudflare
sits in front of that as well.

Getting it wrong is not cosmetic. Too low and every visitor shares one rate-limit
bucket; too high and a client can spoof the header to dodge the limit entirely.

Caddy:

```caddy
samband.example.se {
    reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

With either, bind the container to localhost so it is not reachable directly —
in `.env`:

```bash
SAMBAND_PORT=127.0.0.1:3000
```

### B8. Updating

```bash
cd /opt/samband
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

The database lives in the bind-mounted `./data`, so pulls and restarts never
touch it. Schema migrations run automatically at startup and log what they did.

Take a snapshot first if the release notes mention a migration:

```bash
docker compose -f docker-compose.ghcr.yml exec app \
  wget -qO- http://127.0.0.1:3000/api/health   # confirm it is healthy first
cp -a data data.bak-$(date +%F)
```

### B9. Rolling back

```bash
echo "SAMBAND_TAG=1.0.0" >> .env
docker compose -f docker-compose.ghcr.yml up -d
```

Migrations are forward-only: they do not un-apply when you run an older image.
Rolling back across a schema change means restoring the database snapshot too.

### B10. Verifying provenance (optional)

Every image carries a signed attestation proving it was built by this workflow
from this repository:

```bash
gh attestation verify oci://ghcr.io/whoopsi-daisy/samband:latest \
  --repo whoopsi-daisy/samband
```

### Without compose

```bash
mkdir -p /opt/samband/data && sudo chown -R 1001:1001 /opt/samband/data

docker run -d \
  --name samband \
  --restart unless-stopped \
  --init \
  -p 3000:3000 \
  -e TZ=Europe/Stockholm \
  -e STATS_USER=admin \
  -e STATS_PASSWORD=change-me \
  -v /opt/samband/data:/app/data \
  ghcr.io/whoopsi-daisy/samband:latest
```

The healthcheck is baked into the image, so `docker ps` shows `(healthy)` here
too.

## GHCR troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Push fails: `denied: installation not allowed` | The workflow lacks `packages: write`, almost always an org-level cap. See [A2](#a2-allow-actions-to-write-packages). |
| Pull fails: `denied` or `manifest unknown` | The package is still private. See [A4](#a4-make-the-package-public). A public *repo* does not make the *package* public. |
| Pull fails: `unauthorized: authentication required` | Private package and you are not logged in. See [A7](#a7-keeping-the-image-private-instead). |
| `exec format error` on start | Wrong architecture — the image was built amd64-only and the host is arm64. Rebuild with both platforms, or run the workflow with `linux/arm64`. |
| Container is `Up` but never `(healthy)` | `/api/health` is failing. `docker compose logs`. Usually `./data` not writable by uid 1001 ([B3](#b3-create-the-data-directory-with-the-right-owner)). |
| `SQLITE_CANTOPEN` / `attempt to write a readonly database` | Same — `sudo chown -R 1001:1001 data`. |
| Event times are 1–2 hours off | `TZ` is not `Europe/Stockholm`. |
| Workflow did not run at all | `publish.yml` only triggers on `main` and `v*.*.*` tags. Pushing a feature branch runs `ci.yml` only, by design. |
| Every visitor shares one rate limit | `RATE_LIMIT_PROXY_HOPS` is wrong for your proxy chain ([B7](#b7-behind-a-reverse-proxy)). |

---

### Updating a source build

If you build from source rather than pulling:

```bash
git pull
docker compose up -d --build
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

### Does it really get everything?

That is the whole point of a full import, so here is exactly how it behaves
against a feed that keeps moving.

The API paginates a **live, newest-first** list, and events keep being published
during a run that takes hours. The importer walks pages in **ascending** order,
which is the direction that makes this safe:

- New events are inserted at the head, so every existing event moves toward
  **later** pages — away from the cursor. An event can never slip behind it.
- The cost is re-reading events already stored. `INSERT OR IGNORE` absorbs those,
  which is why a run reports a large "already had" count.

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

**Verifying a run.** Both the CLI and the API report coverage against the
API's own event count:

```
  stored now  333 478
  API reports 333 478 events -> 100.00% coverage
```

```bash
curl -u admin:secret http://localhost:3000/api/import/brottsplatskartan
# {"status":"complete","storedEvents":333478,"totalEvents":333478,"coveragePercent":100,...}
```

A small shortfall is possible and harmless: records the API serves without a
usable id or date are skipped rather than stored half-formed. Re-running
`--mode=full` sweeps again — if the number does not move, the archive is fully
read. It is safe to re-run at any time; it stores nothing it already has.

### Keeping your own realtime feed

Importing the archive does not change how the app collects data. The polisen.se
refresh keeps running on its 10-minute schedule throughout, writing to `events`,
completely independently of `bpk_events`. This is covered by tests that write
and read polisen events while an import is in flight, and that assert a
completed import leaves the `events` table byte-identical.

The intended sequence is exactly what you described:

1. `BPK_IMPORT_ON_START=full` — imports the archive once, resuming across
   restarts if interrupted.
2. Once complete, the same setting switches to an incremental sync on each boot,
   so the archive stays current without re-walking it.
3. The polisen.se scheduler runs the whole time and is your realtime source.

### Other caveats

- **Duplication with polisen.se.** Brottsplatskartan largely republishes
  polisen.se, so recent events will exist in both tables in different shapes.
  The `external_source_link` column holds the polisen.se URL if you want to
  correlate them.
- **Deep pagination** — request ~3,300 (or ~33,000 at 10/page) is a large
  `OFFSET`. If the API slows down or starts failing that deep, the importer
  retries with backoff and, if it still cannot proceed, stops with progress
  saved so a later re-run continues. This has not been exercised against the
  live API.
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

Image publishing is covered in full under
[Deploying from GHCR → Part A](#part-a--publish-images-from-your-repository).
The short version:

```bash
npm version 1.2.0 --no-git-tag-version   # keep package.json in step
git commit -am "Release 1.2.0"
git tag v1.2.0
git push origin main --tags
```

That publishes `1.2.0`, `1.2`, `1` and `latest`. A pre-release tag
(`v1.2.0-rc.1`) publishes only that exact version and moves none of the others.


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
