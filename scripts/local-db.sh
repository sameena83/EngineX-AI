#!/usr/bin/env bash
#
# The local development database, without a service manager.
#
# The demo database is a Postgres cluster inside the project (data/pg5433, which
# is gitignored). Without this script, a reboot leaves the app answering 500 on
# every API call with "ECONNREFUSED 127.0.0.1:5433" — which reads like a bug in
# the app rather than a database that is not running.
#
#   scripts/local-db.sh start     # start it (no-op if already running)
#   scripts/local-db.sh stop      # stop it cleanly
#   scripts/local-db.sh status    # is it running?
#   scripts/local-db.sh reset     # recreate the cluster from scratch (asks first)
#
# Override with LOCAL_PG_DIR / LOCAL_PG_PORT / LOCAL_PG_NAME if you keep the
# cluster somewhere else or want a different database name.
#
# It runs the host's own Postgres binaries (Homebrew's postgresql@16 on macOS,
# the distro package on Linux), because the app needs a real Postgres and this is
# for local development only. Any managed Postgres works by setting DATABASE_URL.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${LOCAL_PG_DIR:-$ROOT/data/pg5433}"
PORT="${LOCAL_PG_PORT:-5433}"
NAME="${LOCAL_PG_NAME:-enginex_final}"
LOG="$ROOT/.logs/pg${PORT}.log"

# macOS: without a valid locale the postmaster refuses to start ("postmaster
# became multithreaded during startup"). It has to be set before pg_ctl runs.
export LC_ALL="${LC_ALL:-C}"

usage() {
  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

require_binaries() {
  for bin in pg_ctl initdb psql createdb; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "local-db: $bin is not on PATH. Install Postgres (brew install postgresql@16," >&2
      echo "          or your distro's postgresql package), or point DATABASE_URL at any" >&2
      echo "          other Postgres and ignore this script." >&2
      exit 1
    fi
  done
}

is_running() {
  pg_ctl -D "$DIR" status >/dev/null 2>&1
}

cmd_start() {
  require_binaries
  if [ ! -f "$DIR/PG_VERSION" ]; then
    echo "local-db: $DIR is not a database cluster yet. Creating one."
    mkdir -p "$(dirname "$DIR")" "$ROOT/.logs"
    initdb -D "$DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
  fi
  if is_running; then
    echo "local-db: already running on port $PORT"
  else
    mkdir -p "$ROOT/.logs"
    pg_ctl -D "$DIR" -l "$LOG" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" start
  fi
  # The app creates its own schema, but the database has to exist first.
  if ! psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname = '$NAME'" | grep -q 1; then
    createdb -h 127.0.0.1 -p "$PORT" -U postgres "$NAME"
    echo "local-db: created database $NAME"
  fi
  echo "local-db: ready at postgres://postgres@127.0.0.1:$PORT/$NAME"
}

cmd_stop() {
  require_binaries
  if is_running; then
    pg_ctl -D "$DIR" stop -m fast
  else
    echo "local-db: not running"
  fi
}

cmd_status() {
  require_binaries
  if is_running; then
    pg_ctl -D "$DIR" status
  else
    echo "local-db: not running (start it with scripts/local-db.sh start)"
    exit 1
  fi
}

cmd_reset() {
  require_binaries
  echo "local-db: this deletes every workspace in $DIR and re-seeds the sample market."
  read -r -p "Type 'reset' to continue: " answer
  [ "$answer" = "reset" ] || { echo "local-db: cancelled"; exit 1; }
  is_running && pg_ctl -D "$DIR" stop -m fast
  rm -rf "$DIR"
  cmd_start
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  reset) cmd_reset ;;
  *) usage ;;
esac
