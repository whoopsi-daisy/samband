#!/usr/bin/env bash
#
# Export the samband SQLite database to a single portable file.
#
# Run this on the machine that currently holds the data — e.g. the Proxmox LXC
# container running the app. It uses SQLite's online backup API, which produces
# a consistent snapshot even while the app is running and writing, so there is
# no need to stop the service first.
#
# Copying events.db with cp/scp is NOT equivalent: the database runs in WAL
# mode, so recent writes live in events.db-wal and a plain copy of the main file
# alone silently loses them.
#
# Usage:
#   ./scripts/export-db.sh [SOURCE_DB] [OUTPUT_FILE]
#
# Defaults:
#   SOURCE_DB    ./data/events.db
#   OUTPUT_FILE  ./samband-export-<timestamp>.db
set -euo pipefail

SOURCE_DB=${1:-./data/events.db}
OUTPUT_FILE=${2:-./samband-export-$(date +%Y%m%d-%H%M%S).db}

die() { echo "error: $*" >&2; exit 1; }

[ -f "$SOURCE_DB" ] || die "no database at $SOURCE_DB
Pass the path explicitly: ./scripts/export-db.sh /path/to/events.db"

# Refuse to clobber an existing export.
[ -e "$OUTPUT_FILE" ] && die "$OUTPUT_FILE already exists; pick another name"

echo "Exporting $SOURCE_DB -> $OUTPUT_FILE"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$SOURCE_DB" ".backup '$OUTPUT_FILE'"
  INTEGRITY=$(sqlite3 "$OUTPUT_FILE" 'PRAGMA integrity_check;')
  EVENTS=$(sqlite3 "$OUTPUT_FILE" 'SELECT COUNT(*) FROM events;')
  LOGS=$(sqlite3 "$OUTPUT_FILE" 'SELECT COUNT(*) FROM fetch_log;')
  OLDEST=$(sqlite3 "$OUTPUT_FILE" 'SELECT COALESCE(MIN(event_time), "n/a") FROM events;')
  NEWEST=$(sqlite3 "$OUTPUT_FILE" 'SELECT COALESCE(MAX(event_time), "n/a") FROM events;')
else
  # No sqlite3 CLI, but the app itself ships better-sqlite3 — reuse it. Run from
  # the app directory so the module resolves.
  echo "sqlite3 CLI not found, falling back to the app's better-sqlite3"
  command -v node >/dev/null 2>&1 || die "neither sqlite3 nor node is available"

  read -r INTEGRITY EVENTS LOGS OLDEST NEWEST <<<"$(node -e '
    const Database = require("better-sqlite3");
    const [src, out] = process.argv.slice(1);
    (async () => {
      const db = new Database(src, { readonly: true });
      await db.backup(out);
      db.close();
      const copy = new Database(out, { readonly: true });
      const one = (sql) => Object.values(copy.prepare(sql).get())[0];
      process.stdout.write([
        one("PRAGMA integrity_check"),
        one("SELECT COUNT(*) AS v FROM events"),
        one("SELECT COUNT(*) AS v FROM fetch_log"),
        one("SELECT COALESCE(MIN(event_time), \x27n/a\x27) AS v FROM events"),
        one("SELECT COALESCE(MAX(event_time), \x27n/a\x27) AS v FROM events"),
      ].join(" "));
      copy.close();
    })().catch((err) => { console.error(err.message); process.exit(1); });
  ' "$SOURCE_DB" "$OUTPUT_FILE")"
fi

[ "$INTEGRITY" = "ok" ] || die "integrity check failed on the export: $INTEGRITY"

SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)

cat <<EOF

Export complete.

  file        $OUTPUT_FILE
  size        $SIZE
  integrity   $INTEGRITY
  events      $EVENTS
  fetch_log   $LOGS
  oldest      $OLDEST
  newest      $NEWEST

Copy it to the Docker host, then import it:

  scp $OUTPUT_FILE user@docker-host:/path/to/samband/
  ./scripts/import-db.sh $(basename "$OUTPUT_FILE")
EOF
