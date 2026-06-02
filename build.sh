#!/usr/bin/env bash
# Produce sparke.min.js. Dev-only tooling; the library itself has no build step.
# Requires network for npx esbuild (not committed as a dependency).
set -e
cd "$(dirname "$0")"
npx --yes esbuild sparke.js \
  --minify --legal-comments=none \
  --banner:js='/*! Sparke - instant-navigation enhancement. https://github.com/ (MIT) */' \
  > sparke.min.js
echo "built sparke.min.js ($(wc -c < sparke.min.js) bytes raw, $(gzip -9 -c sparke.min.js | wc -c) gzip)"
