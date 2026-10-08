#!/usr/bin/env bash
# The one-at-a-time measurements of 7 Oct 2026 (ADR-036, "Gerçekçi küme"):
# speed and memory with nothing else transcribing, the other browsers with
# the frozen settings, and the 51-minute call on its own. Every step takes
# the machine-wide measure lock for itself and gives it back.
#
#   npm run build && npx next start -p 3331      (production build, both models in public/models)
#   bash scripts/transcript/measure-real.sh
#
# The accuracy tables come from run-parts.mjs (several browsers side by side);
# see the ADR for the exact commands.
set -u
cd "$(dirname "$0")/../.."
BASE=${BASE:-http://127.0.0.1:3331}
run() { # owner, then run-app arguments
  local owner=$1
  shift
  node scripts/lib/measure-lock.mjs run "agent transcript-quality: $owner" -- node scripts/transcript/run-app.mjs --base="$BASE" "$@"
  echo "$owner exit $?"
}
NEG="--sets=neg,negh,negv,rneg,rnegv,pause --clips=next-music,next-music-v,steps-libri-v"
run "speed base after" --model=base --clips=ami-is1009a --tag=speed-after-base
run "speed base before" --model=base --settings=2026-10-05 --clips=ami-is1009a --tag=speed-before-base
run "speed turbo after" --model=turbo --headed --clips=ami-is1009a --tag=speed-after-turbo
run "chrome base after" --browser=chrome --model=base $NEG --tag=after-chrome-base
run "edge base after" --browser=msedge --model=base $NEG --tag=after-msedge-base
run "firefox base after" --browser=firefox --model=base $NEG --tag=after-firefox-base
run "51 min base after" --model=base --clips=earn-4474229 --tag=speed-after-base-51
echo "measure-real: done"
