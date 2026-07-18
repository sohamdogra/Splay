#!/bin/zsh
set -eu

script_dir="${0:A:h}"
repo="${GBRAIN_LOCAL_REPO:-${script_dir:h}/.gbrain-cache}"
server="$script_dir/local-gbrain-mcp.py"

# Refresh only by fast-forward. A failed refresh is acceptable only while the
# server's independent 48-hour freshness gate still passes.
git -C "$repo" pull --ff-only --quiet 2>/dev/null || true
export GBRAIN_LOCAL_REPO="$repo"
exec /usr/bin/python3 "$server"
