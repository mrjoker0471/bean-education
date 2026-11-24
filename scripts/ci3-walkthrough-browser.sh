#!/bin/bash
# ─── CI-3H: authenticated browser walkthrough (teacher CI surfaces + API) ─────
# Genuine authenticated verification of the CI-3 surfaces on the fleet branch,
# following the repo's agent-browser convention (scripts/ci2-walkthrough-*.sh).
# Log: /tmp/verify/ci3-browser.txt — screenshots: docs/screenshots/ci3/
#
# Requires: dev server on :3001 serving the fleet-branch worktree and the
# fixtures seeded by `bun scripts/ci3-walkthrough-seed.ts`.
set -u
cd /home/z/ci3c
mkdir -p docs/screenshots/ci3 /tmp/verify
L=/tmp/verify/ci3-browser.txt
: > "$L"

log() { echo "$1" >> "$L"; }
step() { echo "--- $1" >> "$L"; }
shot() { agent-browser screenshot "docs/screenshots/ci3/$1.png" >/dev/null 2>&1 && echo "shot $1" >> "$L" || echo "SHOT-FAIL $1" >> "$L"; }

BASE=http://localhost:3001
DEMO_PASS='bean-ci3-demo'
J=/tmp/verify/ci3-cookies.txt

curl -s -o /dev/null --max-time 30 "$BASE/" || { log "SERVER FAILED"; exit 1; }
log "server up (CI-3 fleet branch worktree, port 3001)"
# warm-up: first compile of / and the auth view can take ~10s on a cold dev server
agent-browser open "$BASE/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 4
agent-browser open "$BASE/#/auth" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 3
log "warm-up complete"

wait_text() {
  local needle="$1" tries="${2:-30}"
  for i in $(seq 1 "$tries"); do
    t=$(agent-browser get text "main" 2>/dev/null)
    echo "$t" | grep -qi "$needle" && return 0
    sleep 1
  done
  return 1
}

login() {
  agent-browser cookies clear >/dev/null 2>&1
  agent-browser storage local clear >/dev/null 2>&1
  agent-browser open "$BASE/#/auth" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 3
  # the auth view is the three-audience panel: pick the TEACHER audience,
  # switch to the Sign in tab, fill, submit (verified flow)
  TREF=$(agent-browser snapshot -i 2>/dev/null | grep -o 'button "Teacher Apply to teach[^"]*" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*' | tail -1)
  [ -n "$TREF" ] && agent-browser click @$TREF >/dev/null 2>&1
  sleep 2
  TABREF=$(agent-browser snapshot -i 2>/dev/null | grep -o 'button "Sign in" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*' | tail -1)
  [ -n "$TABREF" ] && agent-browser click @$TABREF >/dev/null 2>&1
  sleep 1
  agent-browser find label "Email" fill "ci3-teacher@bean.test" >/dev/null 2>&1
  agent-browser find label "Password" fill "$DEMO_PASS" >/dev/null 2>&1
  SUBREF=$(agent-browser snapshot -i 2>/dev/null | grep 'lucide-log-in' | grep -o 'ref=e[0-9]*' | cut -d= -f2 | head -1)
  if [ -n "$SUBREF" ]; then agent-browser click @$SUBREF >/dev/null 2>&1; else agent-browser find last "button[type=submit]" click >/dev/null 2>&1; fi
  sleep 3
  log "login debug: hash=$(agent-browser eval 'location.hash' 2>/dev/null | tail -1) tref=$TREF tabref=$TABREF subref=$SUBREF"
  # the legal-acceptance gate (updated documents) blocks signed-in navigation —
  # accept both documents honestly when it appears
  if [ "$(agent-browser get text 'main' 2>/dev/null | grep -c 'legal documents have changed')" != "0" ]; then
    CBREFS=$(agent-browser snapshot -i 2>/dev/null | grep -o 'checkbox "I have read[^"]*" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*')
    for CB in $CBREFS; do agent-browser click @$CB >/dev/null 2>&1; sleep 1; done
    ACCREF=$(agent-browser snapshot -i 2>/dev/null | grep -o 'button "Accept both documents" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*' | tail -1)
    [ -n "$ACCREf" ] && agent-browser click @$ACCREf >/dev/null 2>&1
    ACCREF=$(agent-browser snapshot -i 2>/dev/null | grep -o 'button "Accept both documents" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*' | tail -1)
    [ -n "$ACCREREF" ] && agent-browser click @$ACCREREF >/dev/null 2>&1
    agent-browser find text "Accept both documents" click >/dev/null 2>&1
    sleep 3
    log "legal gate accepted: hash=$(agent-browser eval 'location.hash' 2>/dev/null | tail -1)"
  fi
  # post-login the app routes to the teach dashboard; the CI panel is the
  # "Classroom Intelligence" TAB on it
  agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 3
  TAB=$(agent-browser snapshot -i 2>/dev/null | grep -o 'tab "Classroom Intelligence" \[ref=e[0-9]*\]' | grep -o 'e[0-9]*' | tail -1)
  [ -n "$TAB" ] && agent-browser click @$TAB >/dev/null 2>&1
  sleep 4
  # success condition: PANEL CONTENT (not the tab label) is on screen
  t=$(agent-browser get text "main" 2>/dev/null)
  echo "$t" | grep -qi "Consent granted\|consent granted\|Pause evaluations\|Enable evaluations" && return 0
  return 1
}

# ── 1. teacher sign-in and CI overview ──
step "1. teacher sign-in → Classroom Intelligence overview"
if login; then log "LOGIN OK (teacher CI view reached)"; else log "LOGIN FAIL"; fi
shot "ci3-teacher-ci-overview-desktop"

step "2. evaluated class A shows the evidence-backed report + fleet activity"
wait_text "Quadratic equations" 25
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "Classroom Intelligence" && log "CI panel visible" || log "CI panel MISSING"
echo "$t" | grep -qi "requires review\|Requires human review\|advisory" && log "honest review markers visible" || log "review markers not on this screen"
shot "ci3-class-report-desktop"
open_report() {
  REF=$(agent-browser snapshot -i 2>/dev/null | grep -i "Quadratic equations" | grep -o 'ref=e[0-9]*' | cut -d= -f2 | head -1)
  [ -n "$REF" ] && agent-browser click @$REF >/dev/null 2>&1
  sleep 3
}
open_report
shot "ci3-evaluation-detail-desktop"

step "3. fleet counts via the API (cookie-authenticated)"
SESSION_COOKIE=$(agent-browser cookies 2>/dev/null | grep -o 'bean_session=[A-Za-z0-9_-]*' | head -1)
log "session cookie present: $([ -n "$SESSION_COOKIE" ] && echo yes || echo no)"
CURLOPTS=(-s --max-time 20 -H "Content-Type: application/json" -H "Origin: $BASE" -H "Cookie: $SESSION_COOKIE")
FLEET=$(curl "${CURLOPTS[@]}" "$BASE/api/teach/classroom-intelligence")
echo "$FLEET" | head -c 1500 >> "$L"
echo "" >> "$L"
echo "$FLEET" | grep -o '"fleet":{"total":[0-9]*,"completed":[0-9]*,"failed":[0-9]*,"running":[0-9]*}' | head -2 >> "$L"
echo "$FLEET" | grep -q '"fleet"' && log "FLEET COUNTS PRESENT in teacher overview" || log "fleet counts MISSING"

step "4. observer API RBAC (cookie-authenticated server-side checks)"
CLASSES=$(echo "$FLEET" | grep -o '"classSessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
log "first class id: $CLASSES"
CODE=$(curl "${CURLOPTS[@]}" -o /tmp/verify/ci3-obs-get.json -w "%{http_code}" "$BASE/api/teach/classes/$CLASSES/live/observer")
log "GET observer (owner, non-live class): HTTP $CODE $(cat /tmp/verify/ci3-obs-get.json | head -c 200)"
CODE=$(curl "${CURLOPTS[@]}" -X POST -o /tmp/verify/ci3-obs-post.json -w "%{http_code}" "$BASE/api/teach/classes/$CLASSES/live/observer")
log "POST observer (owner, ended class): HTTP $CODE $(cat /tmp/verify/ci3-obs-post.json | head -c 160)"

# unauthenticated check (no cookies)
CODE=$(curl -s --max-time 20 -o /dev/null -w "%{http_code}" "$BASE/api/teach/classes/$CLASSES/live/observer")
log "GET observer (unauthenticated): HTTP $CODE (expect 401)"

step "5. mobile viewport (390) renders the teacher CI view"
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 2
agent-browser open "$BASE/#/dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
shot "ci3-mobile-dashboard"
agent-browser open "$BASE/#/teach/classroom-intelligence" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser open "$BASE/#/classes" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
shot "ci3-mobile-classes"
# horizontal overflow check at 390 and 320
for W in 390 320; do
  agent-browser set viewport $W 844 >/dev/null 2>&1
  sleep 1
  OF=$(agent-browser eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>/dev/null | tail -1)
  log "horizontal overflow at ${W}px: ${OF:-unknown} px"
done

step "6. sticky footer check"
agent-browser set viewport 1440 900 >/dev/null 2>&1
# sticky footer on a SHORT page: the auth view is viewport-bound; the classes
# list of a fresh account is short. Use the legal/terms page (short content).
agent-browser open "$BASE/#/terms" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser open "$BASE/#/auth" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
FOOT=$(agent-browser eval "const f=document.querySelector('footer'); f ? Math.round(window.innerHeight - f.getBoundingClientRect().bottom) : 'no-footer'" 2>/dev/null | tail -1)
PH=$(agent-browser eval "document.documentElement.scrollHeight" 2>/dev/null | tail -1)
log "footer gap on viewport-bound short page (auth) at 1440x900: ${FOOT:-unknown} px (0 = sticky exactly at bottom; page scrollHeight ${PH:-unknown})"
# long page: homepage
agent-browser open "$BASE/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
FOOT2=$(agent-browser eval "const f=document.querySelector('footer'); f ? Math.round(f.getBoundingClientRect().bottom - document.documentElement.scrollHeight) : 'no-footer'" 2>/dev/null | tail -1)
log "footer offset from content end on LONG page (home): ${FOOT2:-unknown} (0 = footer sits at content end, pushed naturally)"

log "=== walkthrough complete ==="
echo "LOG WRITTEN: $L"
