#!/usr/bin/env bash
# Every final check of the 7–8 Oct 2026 transcript work (ADR-036), in one
# place, each step's outcome appended to transcript-results/verify.log AS IT
# FINISHES (a later session can read what was done). A step already logged as
# "ok" is skipped; delete its line (or the log) to run it again.
#
#   bash scripts/transcript/verify-all.sh [step …]      (default: all, in order; name the build too:
#                                                        "build-prod matrix", "build-e2e e2e")
#
# Ports: 3331 (e2e build), 3100 (production build: matrix, screenshots),
# 3104 (static export). Heavy steps take the machine-wide measure lock.
set -u
cd "$(dirname "$0")/../.."
LOG=transcript-results/verify.log
OUT=transcript-results/verify
mkdir -p "$OUT"
touch "$LOG"
STEPS=${*:-all}
want() { [ "$STEPS" = "all" ] || [[ " $STEPS " == *" $1 "* ]]; }
done_ok() { grep -q "^$1 ok " "$LOG"; }
lock() { node scripts/lib/measure-lock.mjs run "agent transcript-quality: $1" -- "${@:2}"; }
step() { # name, command…
  local name=$1
  shift
  want "$name" || return 0
  if done_ok "$name"; then echo "$name: already ok"; return 0; fi
  echo "== $name"
  "$@" > "$OUT/$name.log" 2>&1
  local code=$?
  local summary
  summary=$(grep -E "passed|failed|skipped|flaky|Tests |Test Files|panel-perf\[|error|exit" "$OUT/$name.log" | tail -n 6 | tr '\n' ' ' | cut -c1-600)
  echo "$name $([ $code -eq 0 ] && echo ok || echo FAILED) $(date -u +%FT%TZ) :: $summary" >> "$LOG"
  echo "$name exit $code"
  return $code
}
port_free() { # stop whatever of ours listens on a port
  local pid
  pid=$(netstat -ano | grep ":$1 " | grep LISTEN | awk '{print $NF}' | head -1)
  [ -n "${pid:-}" ] && taskkill //PID "$pid" //F > /dev/null 2>&1
  return 0
}
serve() { # port: `next start` in the background, wait until it answers
  port_free "$1"
  (npx next start -p "$1" > "$OUT/server-$1.log" 2>&1 &)
  for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$1/" && return 0; sleep 2; done
  return 1
}

step typecheck npx tsc --noEmit -p .
step lint npx eslint .
step unit npx vitest run

# ---- the e2e build: full Playwright suite (also runs the real-model tests when public/models is there)
if want e2e || want panel || want shots || [ "$STEPS" = "all" ]; then
  if ! done_ok e2e || ! done_ok panel || ! done_ok shots; then
    port_free 3331
    step build-e2e env CLIP_TEST_HOOKS=1 npm run build || exit 1
    sed -i '/^build-e2e ok /d' "$LOG" # a build is never "already done": the next run builds again
    step e2e lock "full e2e" env E2E_PORT=3331 npx playwright test
    port_free 3331
    serve 3331
    step panel lock "panel perf after" node scripts/transcript/panel-perf.mjs --base=http://127.0.0.1:3331 --tag=after-1440
    step panel390 lock "panel perf after 390" node scripts/transcript/panel-perf.mjs --base=http://127.0.0.1:3331 --tag=after-390 --viewport=390x844
    step shots node scripts/transcript/quality-shots.mjs --base=http://127.0.0.1:3331
    port_free 3331
  fi
fi

# ---- the production build: matrix (Chromium) and the real-model screenshots
if want matrix || want homeshots || [ "$STEPS" = "all" ]; then
  if ! done_ok matrix || ! done_ok homeshots; then
    port_free 3100
    step build-prod npm run build || exit 1
    sed -i '/^build-prod ok /d' "$LOG"
    [ -d tests/media/matrix ] || step matrix-media npm run matrix:media
    serve 3100
    step matrix lock "matrix chromium" node scripts/run-matrix.mjs
    step homeshots env SHOT_URL=http://127.0.0.1:3100 node scripts/home-shots.mjs --only=yazi
    port_free 3100
  fi
fi

# ---- the static export as CI builds it (PowerShell, the workflow's variables), then the Pages smoke test
if want pages || [ "$STEPS" = "all" ]; then
  if ! done_ok pages; then
    port_free 3104
    step build-static powershell -NoProfile -Command "\$env:STATIC_EXPORT='1'; \$env:NEXT_PUBLIC_BASE_PATH='/capcut'; \$env:NEXT_PUBLIC_SUPPORT_CONTACT='https://github.com/erenulutas0/capcut/issues'; \$env:NEXT_PUBLIC_HOSTING_PROVIDER='GitHub Pages (GitHub, Inc.)'; \$env:NEXT_PUBLIC_HOSTING_LOG_POLICY='https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement'; if (Test-Path out) { Remove-Item -Recurse -Force out }; npm run build; exit \$LASTEXITCODE" || exit 1
    sed -i '/^build-static ok /d' "$LOG"
    step static-refuses-hooks bash -c "! CLIP_TEST_HOOKS=1 STATIC_EXPORT=1 npx next build > /dev/null 2>&1"
    step models-out bash -c "node scripts/fetch-models.mjs --models=base,turbo --dest=out/models --copy && node scripts/fetch-models.mjs --models=base,turbo --dest=out/models --check"
    step pages lock "pages smoke" npx playwright test -c playwright.pages.config.ts
    port_free 3104
  fi
fi
echo "verify-all: done"
cat "$LOG"
