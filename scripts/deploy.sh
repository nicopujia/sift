#!/usr/bin/env bash
# Build Sift, zip it WITHOUT the local API key, and publish the install page
# and zip to https://sift.pujia.ar (served by Caddy from /var/www/sift.pujia.ar).
set -euo pipefail
cd "$(dirname "$0")/.."
bun run build >/dev/null
OUT=/var/www/sift.pujia.ar
tmp=$(mktemp -d)
cp -r dist "$tmp/sift"
rm -f "$tmp/sift/local-key.json"
(cd "$tmp" && python3 -m zipfile -c sift.zip sift/)
# Check the zip for the key file and the key text. Lists are captured first:
# under pipefail, `unzip | grep -q` can pass on a match when grep exits early.
listing=$(unzip -Z1 "$tmp/sift.zip")
if grep -q local-key <<<"$listing"; then echo "key file leaked into zip"; exit 1; fi
mkdir "$tmp/check" && (cd "$tmp/check" && unzip -q ../sift.zip)
key=$(python3 -c 'import json; print(json.load(open("local-key.json")).get("apiKey", ""))' 2>/dev/null || true)
if [ -n "$key" ] && grep -rqF -- "$key" "$tmp/check"; then echo "key leaked into zip"; exit 1; fi
if grep -rqE 'sk-or-v1-[0-9a-f]{16}' "$tmp/check"; then echo "an OpenRouter key is in the zip"; exit 1; fi
cp "$tmp/sift.zip" site/index.html site/icon.png "$OUT/"
rm -rf "$tmp"
echo "published $(du -h $OUT/sift.zip | cut -f1) to https://sift.pujia.ar"
