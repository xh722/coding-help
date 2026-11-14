#!/bin/sh
set -eu
root=/opt/interviewcoder-local-rebuild
if [ -x "$root/current/run.sh" ]; then
  exec "$root/current/run.sh" "$@"
fi
exec "$root/run.sh" "$@"
