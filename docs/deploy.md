# Deploying

The deployment is one container plus one directory. The image comes from the
GitHub Container Registry; `docker-compose.yml` in this repository is the
deployment file, and the only one a server needs.

If you want to publish images from your own fork, see
[publishing.md](publishing.md).

## Prerequisites

```bash
docker --version          # 20.10+
docker compose version    # v2: "docker compose", not "docker-compose"
```

## 1. Deployment directory

Nothing from the source tree is needed except the compose file:

```bash
mkdir -p /opt/samband && cd /opt/samband
curl -fsSLO https://raw.githubusercontent.com/whoopsi-daisy/samband/main/docker-compose.yml
curl -fsSLo .env https://raw.githubusercontent.com/whoopsi-daisy/samband/main/.env.example
```

## 2. Data directory

```bash
mkdir -p data
```

The server runs as uid 1001 and the database lives in this directory, so uid
1001 has to be able to write to it. It usually cannot to begin with: Docker
creates a missing bind-mount source as root, and on a cloned repository
`./data` already exists owned by whoever cloned: `mkdir -p` changes nothing
there. The container's entrypoint therefore takes ownership at boot, before
dropping to uid 1001 to run the server, so no host-side `chown` is needed.

If the mount is read-only, on a filesystem that refuses `chown`, or you set
`user:` in compose, the entrypoint says so and the app then refuses to start
with a message naming the directory, the uid it is running as and the fix:

```bash
sudo chown -R 1001:1001 data
```

## 3. Configure

Edit `.env`. Every value has a working default, so an empty file starts fine:
except `/stats`, which answers `503` until you give it credentials:

```bash
STATS_USER=admin
STATS_PASSWORD=change-me
chmod 600 .env
```

`/stats` shows fetch logs, error history and database internals, and the
import API behind it can start or cancel a run lasting hours. It used to be
reachable without a login whenever these were unset, which is what an
untouched `.env` gives you, so the default is now closed. If you genuinely
want it open (a private network, say), ask for that explicitly with
`STATS_PUBLIC=true` rather than by leaving the fields blank.

Full list: [`.env.example`](../.env.example). Do not change `TZ`: the app
parses Swedish wall-clock times out of event text and renders them back, so
anything but `Europe/Stockholm` shifts every event by 1–2 hours.

## 4. Start

```bash
docker compose up -d
docker compose ps
```

```
NAME       IMAGE                                    STATUS
samband    ghcr.io/whoopsi-daisy/samband:latest     Up 2 minutes (healthy)
```

`(healthy)` is the bit that matters: it means `/api/health` is answering. It
takes up to 40 seconds to appear (the healthcheck's start period).

```bash
curl -s http://localhost:3000/api/health
# {"status":"ok","events":0,"lastFetch":"...","lastFetchAgeMinutes":0}
```

`events: 0` on a fresh install is expected. The first fetch backfills about a
week from polisen.se; give it a minute, then reload. `docker compose logs -f`
if anything looks wrong.

## Choosing a tag

`SAMBAND_TAG` in `.env`, defaulting to `latest`.

| Tag | Points at | Use when |
|-----|-----------|----------|
| `latest` | Newest stable release | You want releases without thinking about it |
| `1.2.3` | That exact release | Production: reproducible, no surprise upgrades |
| `1.2` | Newest patch of 1.2 | You want bug fixes but not new features |
| `1` | Newest minor of 1.x | You accept features, not breaking changes |
| `edge` | Newest commit on `main` | You want unreleased changes and accept breakage |
| `sha-abc1234` | One specific commit | Bisecting a regression |

`latest` only ever moves on a real release. A pre-release tag like `v1.3.0-rc.1`
publishes only `1.3.0-rc.1` and never touches `latest`, `1.3` or `1`.

## Behind a reverse proxy

Rate limiting reads the client IP from `X-Forwarded-For`, counting
`RATE_LIMIT_PROXY_HOPS` entries **from the right**: the entries your own
proxies appended, which a client cannot forge. Set it to the number of proxies
in front of the app: `1` for a single nginx/Traefik/Caddy, `2` if Cloudflare
sits in front of that as well.

Getting it wrong is not cosmetic. Too low and every visitor shares one
rate-limit bucket; too high and a client can spoof the header to dodge the limit
entirely.

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

The import progress stream on `/stats` is server-sent events. nginx buffers
proxied responses by default; the app sends `X-Accel-Buffering: no` so that
stream is passed through, but if a proxy in front of it strips that header the
dashboard falls back to polling on its own.

With either proxy, bind the container to localhost so it is not reachable
directly. In `.env`:

```bash
SAMBAND_PORT=127.0.0.1:3000
```

## Updating

```bash
cd /opt/samband
docker compose pull
docker compose up -d
```

The database lives in the bind-mounted `./data`, so pulls and restarts never
touch it. Schema migrations run automatically at startup and log what they did.

Migrations only have work to do where there is data. On a database that
already holds an imported archive, the first start after upgrading takes a
little longer than usual: migration 3 builds two indexes over every imported
row and normalises event types, and migration 4 builds the full-text search
index, about 20 seconds per 333k events. Each logs a line when it is done, and
each runs once.

**Starting empty and importing afterwards costs nothing at startup**: the
usual case for a new deployment. The first open of an empty database is a few
tens of milliseconds, and the importer indexes each event as it stores it, so
there is no pause and no rebuild to wait for. A 333k-event dump takes about
30 seconds longer than it would without the index; an API walk, which is
network-bound for hours, does not notice.

Budget disk for the search index either way: roughly 350 MB alongside a full
archive, or ~55 MB with `BPK_SEARCH_TOKENIZER=unicode61`: see
[import.md](import.md#searching-it).

Take a snapshot first if the release notes mention a migration:

```bash
cp -a data data.bak-$(date +%F)
```

## Rolling back

```bash
echo "SAMBAND_TAG=1.0.0" >> .env
docker compose up -d
```

Migrations are forward-only: they do not un-apply when you run an older image.
Rolling back across a schema change means restoring the database snapshot too.

## Backups

`events.db` is the entire state. Snapshot it safely while the app runs:

```bash
./scripts/export-db.sh ./data/events.db ./backup-$(date +%F).db
```

Do not just `cp` the file: the database runs in WAL mode, so recent writes live
in `events.db-wal` and a plain copy of the main file alone loses them.

## Verifying provenance (optional)

Every image carries a signed attestation proving it was built by this
repository's workflow:

```bash
gh attestation verify oci://ghcr.io/whoopsi-daisy/samband:latest \
  --repo whoopsi-daisy/samband
```

## Building from source instead

Only needed when working on the code. The build override adds a `build:` block
to the same compose file, so ports, environment and the data mount stay in one
place:

```bash
git clone https://github.com/whoopsi-daisy/samband.git
cd samband
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

To update a source build: `git pull`, then the same command again.

## Without compose

```bash
mkdir -p /opt/samband/data

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

## Migrating an existing install into Docker

If you already run samband directly on a host (e.g. a Proxmox LXC container),
move the collected history across in three steps.

**1. Export on the old host.** This uses SQLite's online backup API, so the app
can keep running while it happens:

```bash
cd /path/to/samband
./scripts/export-db.sh
```

It prints a summary (event count, oldest/newest event, integrity check) and
writes `samband-export-<timestamp>.db`. If the `sqlite3` CLI is not installed,
the script falls back to the `better-sqlite3` module the app already ships.

**2. Copy it to the Docker host:**

```bash
scp samband-export-*.db user@docker-host:/opt/samband/
```

**3. Import and start:**

```bash
cd /opt/samband
docker compose down                        # if already running
sudo ./scripts/import-db.sh samband-export-20260727-143000.db
docker compose up -d
```

`import-db.sh` verifies the file is a real SQLite database, moves any existing
database aside as `events.db.bak-<timestamp>` rather than deleting it, clears
stale WAL sidecars that would otherwise be replayed over the new file, and sets
ownership to uid 1001.

### What happens on first start

Older databases stored `event_time` in two different shapes: UTC
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
container**: that file is your rollback.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Container is `Up` but never `(healthy)` | `/api/health` is failing. `docker compose logs` |
| `SQLITE_CANTOPEN` / `attempt to write a readonly database` | The container now takes ownership of its data directory at boot, so this should be gone. If it survives (read-only mount, NFS, `user:` set in compose), the log names the directory, the uid and the fix: `sudo chown -R 1001:1001 data` |
| `/stats` returns 503 "Systemstatus är avstängd" | `STATS_USER`/`STATS_PASSWORD` are unset. Set them, or `STATS_PUBLIC=true` to leave it open on purpose |
| Event times are 1–2 hours off | `TZ` is not `Europe/Stockholm` |
| Feed is empty on a fresh install | Backfill has not finished; wait a minute and check `/stats` |
| Every visitor shares one rate limit | `RATE_LIMIT_PROXY_HOPS` is wrong for your proxy chain |
| Pull fails: `denied` / `manifest unknown` | The package is private. See [publishing.md](publishing.md) |
| `exec format error` on start | Wrong architecture: the image was built amd64-only for an arm64 host |
| Import panel on `/stats` shows no progress | The dump path must be inside `./data`; check the log tail in the panel and `docker compose logs` |
