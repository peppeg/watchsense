#!/bin/sh
# Started as root: give /app/data to PUID:PGID (default 1000:1000, the `node` user) if
# something in it belongs to someone else (a folder created by Docker or by a NAS UI as
# root, Unraid 99:100, ...), then run the app as PUID:PGID. Started as another user
# (`--user`, `user:` in compose): nothing to fix, run the app as it is.
set -eu

DATA_DIR=/app/data

if [ "$(id -u)" = 0 ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  case "$PUID$PGID" in
    '' | *[!0-9]*)
      echo "[WatchSense] PUID and PGID must be numeric ids (got PUID='$PUID' PGID='$PGID')" >&2
      exit 1
      ;;
  esac

  mkdir -p "$DATA_DIR"
  # Only when needed: an existing install already owned by PUID:PGID is left untouched
  if [ -n "$(find "$DATA_DIR" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit)" ]; then
    echo "[WatchSense] Setting the owner of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR" ||
      echo "[WatchSense] Cannot change the owner of $DATA_DIR: set PUID/PGID to its owner" >&2
  fi

  # An id without an entry in /etc/passwd has no home folder
  HOME="$(getent passwd "$PUID" | cut -d: -f6)"
  export HOME="${HOME:-/tmp}"
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi

[ -w "${HOME:-/}" ] || export HOME=/tmp
exec "$@"
