#!/bin/sh
# The container's first breath.
#
# A volume a host mounts at /data arrives owned by root — Railway's do, and so
# do most — while the server runs as the unprivileged `node` user, because it
# takes uploads from strangers and needs no more than a directory to write.
# Those two facts collide on the first write. So the container starts as root
# for exactly as long as it takes to hand the data directory to `node`, then
# drops to `node` for good. Nothing the server does ever runs as root.
#
# Started as `node` already (a host that sets the user itself), there is
# nothing to hand over and it simply runs.
set -e

DATA_DIR="$(dirname "${EDSAI_DB:-/data/runs.db}")"
ASSETS_DIR="${EDSAI_ASSETS:-/data/assets}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$ASSETS_DIR"
  chown -R node:node "$DATA_DIR" "$ASSETS_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
