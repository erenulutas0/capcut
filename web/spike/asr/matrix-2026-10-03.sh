#!/usr/bin/env bash
# The runs behind docs/spikes/2026-10-03-asr-on-device-english.md, in the order
# they were made. Each `node run-en.mjs` takes and releases the machine-wide
# measure lock. Logs go to web/spike-results/logs/ (gitignored).
#
#   bash matrix-2026-10-03.sh A        # part A only; B, E, F: matrix-2026-10-03-rest.sh; the rest: matrix-2026-10-04-final.sh
# (In part A the distil-small.en run failed to load its fp16 decoder and was repeated with the q4
# decoder; the small-fp16 and turbo runs were repeated later, see matrix-2026-10-03-redo.sh.)
set -u
cd "$(dirname "$0")"
LOGS=../../spike-results/logs
mkdir -p "$LOGS"
NEG=neg-01,neg-02,neg-03,neg-04,neg-05,neg-06,neg-07,neg-08,neg-09,neg-10,neg-11,negh-01,negh-02,negh-03,negh-04,negh-05,negh-06
SHORT=en-01,en-02,en-03,en-04,en-05,en-06,noisy-04
PAUSE=pause-01,pause-02
MIX=mix-clean,mix-music-20,mix-music-10,mix-music-5,mix-music-0,mix-pink-10,mix-pink-5
CORE=$NEG,$PAUSE,$SHORT,long-a,long-fleurs,mix-clean,mix-music-10,mix-music-0
ALLSETS=neg,negh,pause,short,mix,long,stress,tr
run() { # name, then run-en arguments
  local name=$1
  shift
  node run-en.mjs "$@" > "$LOGS/$name.log" 2>&1
  echo "$name exit $?"
}

case "${1:-}" in
A) # WebGPU, Silero pre-filter: every model
  run A-small-fp16 --models=small-fp16 --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,$MIX,long-a,long-b,long-c,long-fleurs,long-fleurs-raw
  run A-base --models=base --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,$MIX,long-a,long-b,long-c,long-fleurs
  run A-distil-small.en --models=distil-small.en --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,$MIX,long-a,long-b,long-fleurs
  run A-turbo --models=turbo --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,$MIX,long-a,long-b,long-fleurs
  for m in moonshine-base moonshine-tiny base-fp16 distil-large-v3.5; do
    run A-$m --models=$m --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$CORE
  done
  # September's weights (fp32 encoder + q4 decoder), for the size / memory / speed comparison only.
  run A-small --models=small --devices=webgpu --pre=silero --sets=$ALLSETS --clips=neg-01,neg-03,neg-08,neg-09,long-a
  ;;
*)
  echo "usage: bash matrix-2026-10-03.sh A"
  exit 1
  ;;
esac
