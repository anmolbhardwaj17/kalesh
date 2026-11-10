#!/usr/bin/env bash
# Launcher. Run it to start the build, and run it again any time to continue
# (after closing the terminal, a usage limit, or a restart). All progress lives in files.
#
#   harness/bin/start.sh            start or continue
#   harness/bin/start.sh --check    only check the setup, do not start Claude
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

say() { printf '\033[1;33m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1. $2"; exit 1; }; }

need node "Install Node 20 or newer."
need npm "It comes with Node."
need git "Install git."
need claude "Install Claude Code: https://code.claude.com/docs/en/quickstart"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node 20 or newer is needed (you have $(node -v))."; exit 1; }
[ -d .git ] || { echo "This folder is not a git repository. The kit adopts an existing game repo."; exit 1; }
if grep -q '{{''GAME}}' CLAUDE.md GOAL_PROMPT.md 2>/dev/null; then echo "Fill the {{...}} placeholders first (KIT_README.md step 3)."; exit 1; fi

if [ ! -d node_modules/playwright ]; then
  say "Installing playwright (and sharp, vitest) as dev dependencies"
  npm install -D playwright sharp vitest --no-audit --no-fund
fi
say "Making sure the test browser is installed"
npx playwright install chromium >/dev/null 2>&1 || echo "Could not install the Playwright browser now. Claude will retry."
git config core.hooksPath .githooks
chmod +x harness/bin/*.mjs .claude/hooks/*.mjs .githooks/* 2>/dev/null || true

PORT="$(node -p 'JSON.parse(require("fs").readFileSync("harness/kit.config.json","utf8")).dashboardPort||4477')"
mkdir -p harness/reports
if ! curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/api/ping"; then
  say "Starting the dashboard on http://localhost:$PORT"
  nohup node harness/bin/dashboard.mjs > harness/reports/dashboard.log 2>&1 &
  sleep 1
fi

if [ "${1:-}" = "--check" ]; then
  node harness/bin/task.mjs status
  say "Setup looks good. Run harness/bin/start.sh to begin."
  exit 0
fi

(command -v open >/dev/null && open "http://localhost:$PORT") >/dev/null 2>&1 || true
# Keep a Mac awake while Claude works (until this script exits).
if command -v caffeinate >/dev/null; then caffeinate -dimsu -w $$ & fi

GOAL="$(node -e 'const s=require("fs").readFileSync("GOAL_PROMPT.md","utf8");const m=s.split("<!-- goal:start -->")[1].split("<!-- goal:end -->")[0];process.stdout.write(m.trim().replace(/\s+/g," "))')"
printf '/goal %s' "$GOAL" | pbcopy 2>/dev/null || true
NAME="$(node -p 'JSON.parse(require("fs").readFileSync("harness/kit.config.json","utf8")).game.toLowerCase().replace(/[^a-z0-9]+/g,"-")')"

say "Starting Claude Code with the goal."
echo "If you do not see '/goal active' within a minute, paste the /goal line (it is on your clipboard on a Mac) and press Enter."
echo "Phase 0 will ask you questions about the look of the game. After you sign off a style, it never waits for you."
claude --permission-mode auto --name "$NAME" "/goal $GOAL"
