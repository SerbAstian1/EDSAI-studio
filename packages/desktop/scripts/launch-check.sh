#!/usr/bin/env bash
# Measure what the desktop shell actually does: how long until the Studio is
# mounted and usable, not how long until a window appears.
#
# Phase 6's acceptance criterion is a launch under 2 s, and it warned that a
# shell around nothing would satisfy that while delivering nothing. So this
# fails when the window opens empty, and the number it prints is time-to-mount.
#
# Needs the Tauri Linux dependencies and a display. Under Xvfb with software
# rendering the figure is conservative — a real desktop with GPU compositing is
# faster, not slower.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
binary="$here/../src-tauri/target/release/edsai-studio"
runs="${1:-5}"
budget_ms="${EDSAI_LAUNCH_BUDGET_MS:-2000}"

if [[ ! -x "$binary" ]]; then
  echo "No release binary. Run: pnpm --filter @edsai/desktop tauri:build" >&2
  exit 2
fi

worst=0
for ((i = 1; i <= runs; i++)); do
  output=$(EDSAI_EXIT_AFTER_LOAD=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    xvfb-run -a --server-args="-screen 0 1440x900x24" "$binary" 2>/dev/null) || {
    echo "run $i: the window opened without the application in it" >&2
    exit 1
  }
  ms=$(sed -n 's/.*mounted in \([0-9]*\) ms.*/\1/p' <<<"$output")
  [[ -n "$ms" ]] || { echo "run $i: no launch time reported" >&2; exit 1; }
  echo "run $i: ${ms} ms"
  (( ms > worst )) && worst=$ms
done

echo "worst of $runs: ${worst} ms against a ${budget_ms} ms budget"
(( worst <= budget_ms )) || { echo "OVER BUDGET" >&2; exit 1; }
