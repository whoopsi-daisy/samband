#!/usr/bin/env bash
#
# Import a database exported by scripts/export-db.sh into the Docker data dir.
#
# Run this on the Docker host, from the repository root, with the container
# stopped. Any existing database is moved aside first, never deleted.
#
# Usage:
#   ./scripts/import-db.sh EXPORT_FILE [DATA_DIR]
#
# Defaults:
#   DATA_DIR  ./data   (the directory docker-compose.yml bind-mounts to /app/data)
set -euo pipefail

# Must match the uid/gid the Dockerfile creates and runs as.
APP_UID=1001
APP_GID=1001

EXPORT_FILE=${1:-}
DATA_DIR=${2:-./data}

die() { echo "error: $*" >&2; exit 1; }

[ -n "$EXPORT_FILE" ] || die "usage: ./scripts/import-db.sh EXPORT_FILE [DATA_DIR]"
[ -f "$EXPORT_FILE" ] || die "no such file: $EXPORT_FILE"

# Decompress into a temp file if needed, so the rest of the script sees a plain
# database either way.
WORK_FILE=$EXPORT_FILE
CLEANUP_FILE=
case "$EXPORT_FILE" in
  *.gz)
    WORK_FILE=$(mktemp)
    CLEANUP_FILE=$WORK_FILE
    trap 'rm -f "$CLEANUP_FILE"' EXIT
    echo "Decompressing $EXPORT_FILE"
    gunzip -c "$EXPORT_FILE" > "$WORK_FILE"
    ;;
esac

# Guard against importing something that is not a database at all — the header
# of every SQLite file starts with this string.
head -c 15 "$WORK_FILE" | grep -q 'SQLite format 3' \
  || die "$EXPORT_FILE is not a SQLite database"

if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY=$(sqlite3 "$WORK_FILE" 'PRAGMA integrity_check;')
  EVENTS=$(sqlite3 "$WORK_FILE" 'SELECT COUNT(*) FROM events;')
  [ "$INTEGRITY" = "ok" ] || die "integrity check failed: $INTEGRITY"
  echo "Verified: $EVENTS events, integrity ok"
else
  echo "sqlite3 CLI not found, skipping integrity check (the app verifies on start)"
fi

if [ -e "$DATA_DIR" ] && [ ! -d "$DATA_DIR" ]; then
  die "$DATA_DIR exists but is not a directory"
fi
mkdir -p "$DATA_DIR"

TARGET=$DATA_DIR/events.db

# Preserve whatever is already there, including the WAL sidecars — dropping a
# new events.db next to a stale events.db-wal would corrupt the result.
if [ -e "$TARGET" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  echo "Existing database found, moving aside with suffix .bak-$STAMP"
  for suffix in "" "-wal" "-shm"; do
    [ -e "$TARGET$suffix" ] && mv "$TARGET$suffix" "$TARGET$suffix.bak-$STAMP"
  done
else
  # No main database, but stray sidecars would still be applied on open.
  for suffix in "-wal" "-shm"; do
    [ -e "$TARGET$suffix" ] && rm -f "$TARGET$suffix"
  done
fi

cp "$WORK_FILE" "$TARGET"

# The container runs as an unprivileged user and must be able to create the
# WAL/SHM files beside the database, so the directory needs to be writable too.
if [ "$(id -u)" -eq 0 ]; then
  chown "$APP_UID:$APP_GID" "$TARGET" "$DATA_DIR"
  echo "Set ownership to $APP_UID:$APP_GID"
else
  echo "Not running as root — ensure $DATA_DIR and $TARGET are writable by uid $APP_UID:"
  echo "  sudo chown -R $APP_UID:$APP_GID $DATA_DIR"
fi

cat <<EOF

Import complete: $TARGET

Start the app:

  docker compose up -d --build

On first start the app migrates any legacy mixed-format timestamps to UTC and
logs how many rows it rewrote. Check it came up cleanly:

  docker compose logs -f
  curl -s http://localhost:3000/api/health
EOF
