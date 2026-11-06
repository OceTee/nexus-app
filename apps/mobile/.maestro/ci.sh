#!/usr/bin/env bash
# Runs inside the CI emulator step (.github/workflows/e2e.yml): installs the
# debug build, routes API, Metro and MinIO ports to the host, runs the suite.
set -euo pipefail
cd "$(dirname "$0")/.."

adb wait-for-device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
for port in 4000 8081 9000; do adb reverse "tcp:$port" "tcp:$port"; done

# Airplane mode is fine here (adb runs over the emulator's own channel); the
# fingerprint flow (T-54) stays manual.
node .maestro/run.mjs --device emulator-5554 --include emulator-only
