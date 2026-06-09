#!/usr/bin/env bash
# Sparke test suite. One command: boots serve.py + headless Chrome once, writes
# the fixtures, runs every test module, prints a pass/fail summary, tears
# everything down, and exits non-zero if anything failed.
#
# Requires: python3, and Google Chrome at the path below (macOS default).
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT=8770
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# --- fixtures (written to demo/, removed on exit) --------------------------
# Every fixture is written into demo/ with a leading underscore (the repo's
# "transient, not a real page" convention), so cleanup can sweep them by glob -
# robust even if a previous run was killed before its trap fired.
sweep() { rm -f demo/_* 2>/dev/null || true; }
sweep  # clear leftovers from any previously-interrupted run
mkfix() { printf '%s' "$2" > "demo/$1"; }

VT_STYLE='<style>::view-transition-old(root),::view-transition-new(root){animation-duration:1s}</style>'

mkfix _a.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page A</title><script src="/sparke.js"></script></head><body class="page-a"><main><h1>Page A</h1><p><a id="toB" href="/demo/_b#target">to B#target</a></p><p><a id="toRedirect" href="/demo/old-about">via redirect</a></p></main></body></html>'
mkfix _b.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page B</title><script src="/sparke.js"></script></head><body class="page-b" data-x="1"><main><h1>Page B</h1><div style="height:1500px">spacer</div><h2 id="target">Target</h2></main></body></html>'
mkfix _cssa.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CSS A</title><link rel="stylesheet" href="/demo/style.css"><style data-marker="cssa">main h1{color:rgb(255,0,0)}</style><script src="/sparke.js"></script></head><body><main><h1>CSS A</h1><p><a id="toB" href="/demo/_cssb">to B</a></p></main></body></html>'
mkfix _cssb.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CSS B</title><link rel="stylesheet" href="/demo/style.css"><script src="/sparke.js"></script></head><body><main><h1>CSS B</h1><p><a id="toA" href="/demo/_cssa">to A</a></p></main></body></html>'
mkfix _race.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Race</title><script src="/sparke.js"></script></head><body><main><h1>Race</h1><a id="slow" href="/demo/_slowpage?delay=800">slow</a> <a id="fast" href="/demo/_fastpage">fast</a></main></body></html>'
mkfix _slowpage.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Slow</title><script src="/sparke.js"></script></head><body><main><h1>Slow</h1></main></body></html>'
mkfix _fastpage.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fast</title><script src="/sparke.js"></script></head><body><main><h1>Fast</h1></main></body></html>'
mkfix _guard.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guard</title><script src="/sparke.js"></script><script>window.addEventListener("sparke:before-swap",function(e){e.preventDefault();});</script></head><body><main><h1>Guard</h1><a id="go" href="/demo/_fastpage">go</a></main></body></html>'
mkfix _launch.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Launch</title><script src="/sparke.js"></script></head><body><main><h1>Launch</h1><p><a id="go" href="/demo/_slowpage?delay=1500">slow page</a></p></main></body></html>'
mkfix _vt1.html "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>VT1</title>$VT_STYLE<script src=\"/sparke.js\" data-transitions></script></head><body><main><h1>VT1</h1><p><a id=\"go\" href=\"/demo/_vt2\">to VT2</a></p></main></body></html>"
mkfix _vt2.html "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>VT2</title>$VT_STYLE<script src=\"/sparke.js\" data-transitions></script></head><body><main><h1>VT2</h1><p><a id=\"back\" href=\"/demo/_vt1\">to VT1</a></p></main></body></html>"
# Per-page script re-execution (data-sparke-rerun). _rerunA carries an "always"
# script, a "once" script and a plain (unmarked) script inside <main>; _rerunB
# is a bare page to swap away to and back.
mkfix _rerunA.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rerun A</title><script src="/sparke.js"></script></head><body><main><h1>Rerun A</h1><p><a id="toB" href="/demo/_rerunB">to B</a></p><script data-sparke-rerun>window.__always=(window.__always||0)+1;</script><script data-sparke-rerun="once">window.__once=(window.__once||0)+1;</script><script>window.__plain=(window.__plain||0)+1;</script></main></body></html>'
mkfix _rerunB.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rerun B</title><script src="/sparke.js"></script></head><body><main><h1>Rerun B</h1><p><a id="toA" href="/demo/_rerunA">to A</a></p></main></body></html>'
# Alpine/Livewire teardown. _alpineA stubs window.Alpine.destroyTree to record
# which roots are torn down, has a persistent shell [x-data] OUTSIDE <main> and a
# Livewire-style component [wire:id] INSIDE it. Swapping to _alpineB (single
# <main>) must destroy the detached in-main component but leave the shell alone.
mkfix _alpineA.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Alpine A</title><script>window.Alpine={destroyTree:function(el){(window.__destroyed=window.__destroyed||[]).push(el.getAttribute("wire:id")||el.getAttribute("data-name")||"?")}};</script><script src="/sparke.js"></script></head><body><div data-name="shell" x-data>shell</div><main><h1>Alpine A</h1><div wire:id="comp-1" wire:snapshot="{}" data-name="comp-1">component</div><p><a id="toB" href="/demo/_alpineB">to B</a></p></main></body></html>'
mkfix _alpineB.html '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Alpine B</title><script src="/sparke.js"></script></head><body><div data-name="shell" x-data>shell</div><main><h1>Alpine B</h1><p><a id="toA" href="/demo/_alpineA">to A</a></p></main></body></html>'

# Committed fixtures live in test/fixtures/; copy them into demo/ so the dev
# server serves them at /demo/<name>, and track them for cleanup on exit.
for f in test/fixtures/*; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  cp "$f" "demo/$base"
done

# --- boot server + chrome --------------------------------------------------
PROFILE="$(mktemp -d)"
python3 serve.py "$PORT" >/dev/null 2>&1 &
SRV=$!
"$CHROME" --headless=new --remote-debugging-port=9222 "--remote-allow-origins=*" \
  --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-software-rasterizer \
  --no-first-run --no-default-browser-check --user-data-dir="$PROFILE" about:blank >/dev/null 2>&1 &
CHR=$!

cleanup() {
  kill "$SRV" "$CHR" 2>/dev/null
  wait "$CHR" 2>/dev/null
  rm -rf "$PROFILE"
  sweep
}
trap cleanup EXIT INT TERM

for i in $(seq 1 40); do curl -s http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break; sleep 0.3; done

# --- run every test module -------------------------------------------------
tests=(
  "unit-test.mjs"
  "bootstrap-test.mjs"
  "links-test.mjs"
  "click-test.mjs"
  "swap-test.mjs"
  "cache-test.mjs"
  "redirect-test.mjs"
  "race-test.mjs"
  "history-test.mjs"
  "head-test.mjs"
  "attr-test.mjs"
  "csslink-test.mjs"
  "active-test.mjs"
  "rerun-test.mjs"
  "a11y-test.mjs"
  "forms-test.mjs"
  "formstate2-test.mjs"
  "events-test.mjs"
  "viewtrans-test.mjs"
  "fallback-test.mjs"
  "loading-test.mjs"
  "config-test.mjs"
  "ignore-test.mjs"
  "future-test.mjs"
  "perf-test.mjs"
  "misc-test.mjs"
  "cdp-test.mjs settings"
  "form-test.mjs"
  "formstate-test.mjs"
  "edge-test.mjs"
  "css-test.mjs"
  "race-guard-test.mjs"
  "slownav-test.mjs"
  "vt-test.mjs"
  "vt-interrupt-test.mjs"
  "alpine-test.mjs"
)

fail=0
for entry in "${tests[@]}"; do
  echo "──── $entry ────"
  out="$(node test/$entry 2>&1)"
  echo "$out"
  if echo "$out" | grep -q "FAIL\|RESULT: FULL RELOAD\|STALE!"; then
    fail=$((fail + 1))
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ all test modules passed"
else
  echo "❌ $fail test module(s) had failures"
fi
exit "$fail"
