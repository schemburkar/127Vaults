#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 from https://nodejs.org/en/download, then rerun. See README.md for container prerequisites.' >&2
  exit 1
fi
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/install.mjs" "$@"
