#!/usr/bin/env bash
# Parts B–F of the runs behind docs/spikes/2026-10-03-asr-on-device-english.md
# (part A is in matrix-2026-10-03.sh; the two files are kept apart only because
# a running bash script must not be edited).
#
#   bash matrix-2026-10-03-rest.sh B        # one part: B E F
# (Parts C and D as first planned were never run in this form; what was run instead is
# matrix-2026-10-04-final.sh.)
set -u
cd "$(dirname "$0")"
LOGS=../../spike-results/logs
mkdir -p "$LOGS"
NEG=neg-01,neg-02,neg-03,neg-04,neg-05,neg-06,neg-07,neg-08,neg-09,neg-10,neg-11,negh-01,negh-02,negh-03,negh-04,negh-05,negh-06
SHORT=en-01,en-02,en-03,en-04,en-05,en-06,noisy-04
PAUSE=pause-01,pause-02
NEGV=negv-01,negv-02,negv-03,negv-04,negv-05,negv-06,negv-07,negv-08
VAL=val-clean,val-pink-5,val-music-5
ALLSETS=neg,negh,negv,val,pause,short,mix,long,stress,tr
run() { # name, then run-en arguments
  local name=$1
  shift
  node run-en.mjs "$@" > "$LOGS/$name.log" 2>&1
  echo "$name exit $?"
}

case "${1:-}" in
B) # No pre-filter (what September measured), and our own detector
  for m in small-fp16 base distil-small.en turbo moonshine-base; do
    run B-$m --models=$m --devices=webgpu --pre=none --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-10,mix-music-0
  done
  run B-own-small-fp16 --models=small-fp16 --devices=webgpu --pre=own,ownabs --sets=$ALLSETS --clips=$NEG,$PAUSE
  run B-own-base --models=base --devices=webgpu --pre=own,ownabs --sets=$ALLSETS --clips=$NEG,$PAUSE
  ;;
E) # What the library's leak and the word times cost (long-a)
  run E-keep --models=small-fp16 --devices=webgpu --pre=silero --keep-caches --suffix=-leak --no-probe --sets=$ALLSETS --clips=long-a,mix-clean,mix-music-10
  run E-segts --models=small-fp16,base --devices=webgpu --pre=silero --no-word-ts --suffix=-segts --no-probe --sets=$ALLSETS --clips=long-a
  ;;
F) # Turkish, briefly
  run F-turbo --models=turbo --devices=webgpu --pre=silero,none --suffix=-tr --sets=tr
  run F-small --models=small-fp16 --devices=webgpu --pre=silero,none --suffix=-tr --sets=tr
  ;;
*)
  echo "usage: bash matrix-2026-10-03-rest.sh B|E|F"
  exit 1
  ;;
esac
