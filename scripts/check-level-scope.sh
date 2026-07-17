#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: npm run check:scope -- <level-id> [base-ref]" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  exit 2
fi

level_id=$1
base_ref=${2:-main}
allowed_prefix="src/levels/${level_id}/"
allowed_registry="src/levels/index.ts"
allowed_gallery="docs/level-gallery.md"
allowed_content_prefix="public/level-content/${level_id}/"

if ! git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  echo "Unknown base ref: $base_ref" >&2
  exit 2
fi

changed_files=$(
  {
    git diff --name-only "$base_ref"
    git ls-files --others --exclude-standard
  } | sort -u
)

[ -n "$changed_files" ] || exit 0

out_of_scope=$(printf '%s\n' "$changed_files" | awk -v prefix="$allowed_prefix" -v registry="$allowed_registry" -v gallery="$allowed_gallery" -v content="$allowed_content_prefix" '
  $0 != registry && $0 != gallery && index($0, prefix) != 1 && index($0, content) != 1 { print }
')

if [ -n "$out_of_scope" ]; then
  echo "Out-of-scope files for level '$level_id':" >&2
  printf '%s\n' "$out_of_scope" >&2
  exit 1
fi
