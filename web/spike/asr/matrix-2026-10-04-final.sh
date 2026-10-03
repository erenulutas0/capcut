#!/usr/bin/env bash
# The last runs (4 October), most important first, each one short: the machine
# was shared and the measure lock was contended, so every call waits 65 s and
# then queues for the lock. A finished result is never run again (run-en.mjs
# skips it), so this script can simply be started again after an interruption.
#
#   bash matrix-2026-10-04-final.sh
#
# The shipping combination, fixed before the validation clips (negv-*, val-*)
# existed: Silero VAD with its default settings → every speech span recognised
# on its own → a span is dropped when its mean token log-probability is under
# -0.75 or its text is a repetition loop (zlib ratio over 2.4).
set -u
cd "$(dirname "$0")"
LOGS=../../spike-results/logs
mkdir -p "$LOGS"
NEG=neg-01,neg-02,neg-03,neg-04,neg-05,neg-06,neg-07,neg-08,neg-09,neg-10,neg-11,negh-01,negh-02,negh-03,negh-04,negh-05,negh-06
NEGV=negv-01,negv-02,negv-03,negv-04,negv-05,negv-06,negv-07,negv-08
SHORT=en-01,en-02,en-03,en-04,en-05,en-06,noisy-04
PAUSE=pause-01,pause-02
VAL=val-clean,val-pink-5,val-music-5
ALLSETS=neg,negh,negv,val,pause,short,mix,long,stress,tr
SHIP="--pre=silero --per-span --guard=lp:-0.75,cr:2.4 --suffix=-ship --no-probe --sets=$ALLSETS"
run() { # log name, then run-en arguments; the log is appended to, never replaced
  local name=$1
  shift
  node run-en.mjs "$@" >> "$LOGS/$name.log" 2>&1
  echo "$name exit $?"
}

# 1. Shipping combination on WebGPU: the two candidates
run G-ship-base --models=base --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT,$VAL,long-a,mix-clean,mix-music-0
run G-ship-turbo --models=turbo --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT,$VAL,long-a,mix-clean,mix-music-0
# 2. The same on WASM (q8 weights)
run G-ship-wasm-base --models=base --devices=wasm $SHIP --clips=$NEG,$NEGV,$PAUSE,val-clean
# 3. WASM speed, accuracy, memory: all threads, 4 threads, one thread without cross-origin isolation
run G-wasm-base --models=base --devices=wasm --pre=silero --no-probe --sets=$ALLSETS --clips=$SHORT,long-a,mix-clean
run G-wasm-small --models=small --devices=wasm --pre=silero --no-probe --sets=$ALLSETS --clips=$SHORT,long-a,mix-clean
run G-wasm-t4 --models=base,small --devices=wasm --threads=4 --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
run G-wasm-noiso --models=base --devices=wasm --no-isolation --suffix=-noiso --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
run G-webgpu-noiso --models=base --devices=webgpu --no-isolation --suffix=-noiso --pre=silero --no-probe --sets=$ALLSETS --clips=mix-clean
# 4. Other browsers, shipping combination
run G-chrome --browsers=chrome --models=base --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT
run G-msedge --browsers=msedge --models=base --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT
run G-firefox --browsers=firefox --models=base --devices=wasm $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT
# 5. Less important: small on WASM and WebGPU with the shipping combination, Moonshine per span
run G-ship-wasm-small --models=small --devices=wasm $SHIP --clips=$NEG,$NEGV,$PAUSE,val-clean
run G-ship-small-fp16 --models=small-fp16 --devices=webgpu $SHIP --clips=$NEG,$NEGV,$PAUSE,$SHORT,$VAL,long-a,mix-clean,mix-music-0
run G-span-moonshine-base --models=moonshine-base --devices=webgpu --pre=silero --per-span --suffix=-span --no-probe --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-0
run G-wasm-moonshine-base --models=moonshine-base --devices=wasm --pre=silero --no-probe --sets=$ALLSETS --clips=$SHORT,long-a,mix-clean
# 6. The English Silero run of small-fp16 that the Turkish run replaced (see matrix-2026-10-03-redo.sh)
run G-redo-small-fp16 --models=small-fp16 --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,long-b,long-fleurs,mix-clean,mix-music-20,mix-music-10,mix-music-5,mix-music-0,mix-pink-10,mix-pink-5
