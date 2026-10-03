#!/usr/bin/env bash
# The order the remaining parts were run in after the phone run finished.
set -u
cd "$(dirname "$0")"
until grep -q "^cleanup:\|skipped$\|phone run failed" ../../spike-results/logs/phone.log 2>/dev/null; do sleep 10; done
sleep 20
bash matrix-2026-10-03-redo.sh
bash matrix-2026-10-03-rest.sh D
bash matrix-2026-10-03-rest.sh C
