#!/bin/sh
set -eu
ROOT="$HOME/.local/share/codex-copilot"
export PATH="$ROOT/runtime/bin:$PATH"
export COPILOT_API_HOME="$ROOT/gateway"
exec "$ROOT/tools/node_modules/.bin/copilot-api" "$@"
