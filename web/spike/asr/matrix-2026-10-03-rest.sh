#!/usr/bin/env bash
# Parts B–F of the runs behind docs/spikes/2026-10-03-asr-on-device-english.md
# (part A is in matrix-2026-10-03.sh; the two files are kept apart only because
# a running bash script must not be edited).
#
#   bash matrix-2026-10-03-rest.sh B        # one part: B C D E F
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
C) # WASM (q8): all threads; 4 threads; one thread without cross-origin isolation (what GitHub Pages gives today)
  for m in base small moonshine-base; do
    run C-$m --models=$m --devices=wasm --pre=silero --no-probe --sets=$ALLSETS --clips=$SHORT,long-a,mix-clean
  done
  for m in base small; do
    run C-t4-$m --models=$m --devices=wasm --threads=4 --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
  done
  for m in base; do
    run C-noiso-$m --models=$m --devices=wasm --no-isolation --suffix=-noiso --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
  done
  run C-noiso-webgpu --models=base --devices=webgpu --no-isolation --suffix=-noiso --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
  ;;
D) # The shipping combination, fixed before the validation clips (negv-*, val-*) existed:
  # Silero (default settings) → every speech span recognised on its own → a span whose mean
  # log-probability is under -0.75, or whose text is a repetition loop (zlib ratio over 2.4), is dropped. Then the same in other browsers and on WASM.
  SHIP="--pre=silero --per-span --guard=lp:-0.75,cr:2.4 --suffix=-ship --no-probe --sets=$ALLSETS"
  # (The distilled models are not here: part A showed they give no word times in these exports
  # and that their log-probability does not tell invented text from speech.)
  for m in small-fp16 base turbo; do
    run D-ship-$m --models=$m --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT,$VAL,long-a,mix-clean,mix-music-0
  done
  # Moonshine has no figures from part A to set a threshold with: first every span on its own
  # without a guard on the clips used so far, then (D2) the validation clips with the threshold chosen from that.
  run D-span-moonshine-base --models=moonshine-base --devices=webgpu --pre=silero --per-span --suffix=-span --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-0
  run D-ship-wasm --models=base,small --devices=wasm $SHIP --clips=$NEG,$NEGV,$PAUSE,val-clean
  for b in chrome msedge; do
    run D-$b --browsers=$b --models=base --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT
  done
  run D-firefox --browsers=firefox --models=base --devices=wasm $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT
  ;;
D2) # Moonshine with its own threshold (argument 2), validation clips included
  run D-ship-moonshine-base --models=moonshine-base --devices=webgpu --pre=silero --per-span --guard=lp:$2,cr:2.4 --suffix=-ship --no-probe --sets=$ALLSETS --clips=$NEG,$NEGV,$PAUSE,$SHORT,$VAL,long-a,mix-clean,mix-music-0
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
  echo "usage: bash matrix-2026-10-03-rest.sh B|C|D|E|F"
  exit 1
  ;;
esac
