#!/bin/sh
# Hand the data directory to the runtime user, then become that user.
#
# The container writes SQLite (plus its -wal and -shm sidecars) into a
# bind-mounted host directory. Whether uid 1001 can write there is decided on
# the host, not in the image, and it usually cannot:
#
#   * `data/.gitkeep` is tracked, so `git clone` already creates ./data owned
#     by whoever cloned. The documented `mkdir -p data` is then a no-op and
#     changes no ownership — only the `chown` that follows it does anything.
#   * Docker creates a missing bind-mount source as root.
#   * Rootless Docker, SELinux relabelling and NFS all remap or refuse
#     ownership in ways no amount of host-side chown reliably settles.
#
# Every one of those produced the same SQLITE_CANTOPEN stack trace at boot,
# from a container that then sat there serving an app with no database.
#
# So: fix it here, where the answer is knowable. The server itself still runs
# as uid 1001 — this script is root only long enough to chown and step down.
set -e

DATA_DIR="${SAMBAND_DATA_DIR:-/app/data}"
APP_UID=1001
APP_GID=1001

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"

  # Only walk the tree when the top of it is wrong. An imported archive is
  # hundreds of thousands of rows and a chown -R over a slow bind mount on
  # every boot is a real delay.
  if [ "$(stat -c %u "$DATA_DIR" 2>/dev/null)" != "$APP_UID" ]; then
    if chown -R "$APP_UID:$APP_GID" "$DATA_DIR" 2>/dev/null; then
      echo "[entrypoint] took ownership of $DATA_DIR for uid $APP_UID"
    else
      # Read-only mounts and some network filesystems refuse this. Say so now;
      # the database preflight will fail with instructions in a moment.
      echo "[entrypoint] warning: could not chown $DATA_DIR — if the app cannot"
      echo "[entrypoint] open its database, fix ownership on the host:"
      echo "[entrypoint]   sudo chown -R $APP_UID:$APP_GID <host data dir>"
    fi
  fi

  exec su-exec "$APP_UID:$APP_GID" "$@"
fi

# Already unprivileged — someone set `user:` in compose, or this is a rootless
# runtime that mapped us. Nothing to hand over; run as whoever we are.
exec "$@"
