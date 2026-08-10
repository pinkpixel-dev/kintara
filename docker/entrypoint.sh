#!/bin/sh
set -e

# Remap the runtime user to whatever owns the mounted volumes.
#
# On a NAS the share is owned by some arbitrary uid, and a container writing as
# a different one produces files nobody can read — or fails to write at all.
# PUID/PGID is the convention people already know from linuxserver.io images.

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

CURRENT_UID="$(id -u kintara)"
CURRENT_GID="$(id -g kintara)"

if [ "$PGID" != "$CURRENT_GID" ]; then
    groupmod -o -g "$PGID" kintara
fi

if [ "$PUID" != "$CURRENT_UID" ]; then
    usermod -o -u "$PUID" kintara
fi

# Only the data directory is chowned. The library is the user's own share and
# may hold thousands of files they own deliberately — taking it over would be
# both slow and rude. The server only needs to read it.
mkdir -p "${KINTARA_DATA_DIR:-/data}"
chown -R kintara:kintara "${KINTARA_DATA_DIR:-/data}" 2>/dev/null || true

if [ ! -w "${KINTARA_LIBRARY_DIR:-/library}" ]; then
    echo "kintara: warning: ${KINTARA_LIBRARY_DIR:-/library} is not writable by uid ${PUID}." >&2
    echo "kintara: uploads and deletions will fail. Check PUID/PGID against the share's owner." >&2
fi

echo "kintara: running as uid ${PUID}, gid ${PGID}"

exec gosu kintara "$@"
