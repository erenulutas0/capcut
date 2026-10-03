#!/usr/bin/env bash
# The runs behind docs/spikes/2026-10-03-asr-on-device-english.md, in the order
# they were made. Each `node run-en.mjs` takes and releases the machine-wide
# measure lock. Logs go to web/spike-results/logs/ (gitignored).
#
#   bash matrix-2026-10-03.sh A        # one part: A B C D E F
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
B) # No pre-filter (what September measured), and our own detector
  for m in small-fp16 base distil-small.en turbo moonshine-base; do
    run B-$m --models=$m --devices=webgpu --pre=none --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-10,mix-music-0
  done
  run B-own-small-fp16 --models=small-fp16 --devices=webgpu --pre=own,ownabs --sets=$ALLSETS --clips=$NEG,$PAUSE
  run B-own-base --models=base --devices=webgpu --pre=own,ownabs --sets=$ALLSETS --clips=$NEG,$PAUSE
  ;;
C) # WASM (q8), all threads, then 4 threads, then one thread without cross-origin isolation
  for m in base small distil-small.en moonshine-base moonshine-tiny; do
    run C-$m --models=$m --devices=wasm --pre=silero --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-10
  done
  for m in base small distil-small.en moonshine-base; do
    run C-t4-$m --models=$m --devices=wasm --threads=4 --pre=silero --no-probe --sets=$ALLSETS --clips=long-a
  done
  for m in base distil-small.en moonshine-base; do
    run C-noiso-$m --models=$m --devices=wasm --no-isolation --suffix=-noiso --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
  done
  run C-noiso-webgpu --models=base,small-fp16 --devices=webgpu --no-isolation --suffix=-noiso --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
  ;;
D) # The shipping combination: Silero + Whisper's own rule applied in the engine; other browsers
  for m in small-fp16 base distil-small.en turbo; do
    run D-guard-$m --models=$m --devices=webgpu --pre=silero --guard=0.6,-1 --suffix=-guard --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-10,mix-music-0
  done
  run D-guard-wasm --models=base,small,distil-small.en --devices=wasm --pre=silero --guard=0.6,-1 --suffix=-guard --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE
  for b in chrome msedge; do
    run D-$b --browsers=$b --models=small-fp16,base --devices=webgpu --pre=silero --guard=0.6,-1 --suffix=-guard --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,mix-clean
  done
  run D-firefox --browsers=firefox --models=base,distil-small.en --devices=wasm --pre=silero --guard=0.6,-1 --suffix=-guard --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,mix-clean
  ;;
E) # What the library's leak and the word times cost (small-fp16, long-a)
  run E-keep --models=small-fp16 --devices=webgpu --pre=silero --keep-caches --suffix=-leak --no-probe --sets=$ALLSETS --clips=long-a,mix-clean,mix-music-10
  run E-segts --models=small-fp16,base --devices=webgpu --pre=silero --no-word-ts --suffix=-segts --no-probe --sets=$ALLSETS --clips=long-a
  ;;
F) # Turkish, briefly
  run F-turbo --models=turbo --devices=webgpu --pre=silero,none --sets=tr
  run F-small --models=small-fp16 --devices=webgpu --pre=silero,none --sets=tr
  ;;
*)
  echo "usage: bash matrix-2026-10-03.sh A|B|C|D|E|F"
  exit 1
  ;;
esac
