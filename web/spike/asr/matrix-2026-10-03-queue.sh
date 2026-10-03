#!/usr/bin/env bash
# The order the last parts were run in (4 October, after the repeats in
# matrix-2026-10-03-redo.sh): the shipping combination first, WASM after.
# Every run-en.mjs call waits 65 s before asking for the measure lock.
set -u
cd "$(dirname "$0")"
bash matrix-2026-10-03-rest.sh D
bash matrix-2026-10-03-rest.sh C
