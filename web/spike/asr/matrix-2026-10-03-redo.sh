#!/usr/bin/env bash
# Four runs made a second time on 3 Oct 2026. The Turkish runs (part F) were first
# started without a --suffix and replaced the result files of the English runs of
# the same two models; the Turkish files were renamed (relabel-result.mjs) and these
# four English runs repeated with exactly the arguments of parts A and B.
# run-en.mjs now refuses to replace a finished result. (The repeat of small-fp16 leaves out
# long-c and long-fleurs-raw, which the first run had; base keeps long-c.)
# Of these four, A3-turbo, B3-small-fp16 and B3-turbo finished on 3 October; A3-small-fp16 was
# cut off while queued for the lock and was done on 4 October as the last line of
# matrix-2026-10-04-final.sh.
#
#   bash matrix-2026-10-03-redo.sh
set -u
cd "$(dirname "$0")"
LOGS=../../spike-results/logs
NEG=neg-01,neg-02,neg-03,neg-04,neg-05,neg-06,neg-07,neg-08,neg-09,neg-10,neg-11,negh-01,negh-02,negh-03,negh-04,negh-05,negh-06
SHORT=en-01,en-02,en-03,en-04,en-05,en-06,noisy-04
PAUSE=pause-01,pause-02
MIX=mix-clean,mix-music-20,mix-music-10,mix-music-5,mix-music-0,mix-pink-10,mix-pink-5
ALLSETS=neg,negh,negv,val,pause,short,mix,long,stress,tr
run() {
  local name=$1
  shift
  node run-en.mjs "$@" > "$LOGS/$name.log" 2>&1
  echo "$name exit $?"
}
run A3-small-fp16 --models=small-fp16 --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,$MIX,long-a,long-b,long-fleurs
run A3-turbo --models=turbo --devices=webgpu --pre=silero --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,$MIX,long-a,long-b,long-fleurs
run B3-small-fp16 --models=small-fp16 --devices=webgpu --pre=none --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-10,mix-music-0
run B3-turbo --models=turbo --devices=webgpu --pre=none --sets=$ALLSETS --clips=$NEG,$PAUSE,$SHORT,long-a,mix-clean,mix-music-10,mix-music-0
