#!/usr/bin/env bash
# The app-path measurements of ADR-036, most important first. Every step takes
# the machine-wide measure lock for itself and gives it back (60 s pause before
# the next one), so other work on this computer gets a turn. A finished clip is
# never run again (run-app.mjs skips it): the script can simply be restarted.
#
#   npm run build && npx next start -p 3321      (production build, models in public/models)
#   bash scripts/transcript/measure-all.sh [step …]     (default: all steps)
set -u
cd "$(dirname "$0")/../.."
BASE=${BASE:-http://127.0.0.1:3321}
LOGS=transcript-results/logs
mkdir -p "$LOGS"
NEG=neg,negh,negv
run() { # name, then run-app arguments
  local name=$1
  shift
  node scripts/lib/measure-lock.mjs run "agent transcript app-path: $name" -- node scripts/transcript/run-app.mjs --base="$BASE" "$@" >> "$LOGS/$name.log" 2>&1
  echo "$name exit $?"
}
want() { [ "$STEPS" = "all" ] || [[ " $STEPS " == *" $1 "* ]]; }
STEPS=${*:-all}

# A. The shipped default (base, WebAssembly, one thread) in Chromium: every set of the spike.
want A && run A-chromium-base --browser=chromium --model=base --sets=$NEG,pause,short,val,mix,long --tag=chromium-base
# H. The optional large model (WebGPU needs a real window).
want H && run H-chromium-turbo --browser=chromium --model=turbo --headed --sets=$NEG,pause,short,val --clips=long-a,mix-clean,mix-music-0 --tag=chromium-turbo
# B–D. The other browsers: negatives, short and pause clips, and 10 minutes for speed and memory.
want B && run B-chrome-base --browser=chrome --model=base --sets=$NEG,pause,short --clips=long-fleurs --tag=chrome-base
want C && run C-msedge-base --browser=msedge --model=base --sets=$NEG,pause,short --clips=long-fleurs --tag=msedge-base
want D && run D-firefox-base --browser=firefox --model=base --sets=$NEG,pause,short --clips=long-fleurs --tag=firefox-base
# E, G. Long files: 60 minutes, then the 120-minute input limit.
want E && run E-chromium-60 --browser=chromium --model=base --clips=long-60min --tag=chromium-base-xlong
want G && run G-chromium-120 --browser=chromium --model=base --clips=long-120min --tag=chromium-base-xlong
# F. 60 minutes in the other browsers.
want F1 && run F-chrome-60 --browser=chrome --model=base --clips=long-60min --tag=chrome-base-xlong
want F2 && run F-msedge-60 --browser=msedge --model=base --clips=long-60min --tag=msedge-base-xlong
want F3 && run F-firefox-60 --browser=firefox --model=base --clips=long-60min --tag=firefox-base-xlong
echo "measure-all: done"
