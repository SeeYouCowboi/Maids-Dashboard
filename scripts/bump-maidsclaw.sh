#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MAIDSCLAW_DIR="$(cd "$REPO_ROOT/../MaidsClaw" 2>/dev/null || echo "")"

if [ -z "$MAIDSCLAW_DIR" ] || [ ! -d "$MAIDSCLAW_DIR" ]; then
  echo "Error: ../MaidsClaw not found relative to $REPO_ROOT" >&2
  exit 1
fi

SHA=$(git -C "$MAIDSCLAW_DIR" rev-parse HEAD 2>/dev/null)
if [ -z "$SHA" ]; then
  echo "Error: Could not read git HEAD from $MAIDSCLAW_DIR" >&2
  exit 1
fi

echo "$SHA" > "$REPO_ROOT/.maidsclaw-version"
echo "Updated .maidsclaw-version to $SHA"
