#!/bin/bash
# ─── CI-2A part 2b: gap-closing checks (dialog-open races from part 2) ───────
set -u
cd /home/z/ci2
L=/tmp/verify/ci2-browser3.txt
: > "$L"
log() { echo "$1" >> "$L"; }
shot() { agent-browser screenshot "docs/screenshots/ci2/$1.png" >/dev/null 2>&1 && echo "shot $1" >> "$L" || echo "SHOT-FAIL $1" >> "$L"; }
wait_text() {
  local needle="$1" tries="${2:-30}"
  for i in $(seq 1 "$tries"); do
    t=$(agent-browser get text "main" 2>/dev/null)
    echo "$t" | grep -qi "$needle" && return 0
    sleep 1
  done
  return 1
}
BASE=http://localhost:3000
DEMO_PASS='bean-ci2-demo'

curl -s -o /dev/null --max-time 30 "$BASE/" || { log "SERVER FAILED"; exit 1; }

login() {
  agent-browser cookies clear >/dev/null 2>&1
  agent-browser storage local clear >/dev/null 2>&1
  agent-browser open "$BASE/#/auth" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 1
  agent-browser find role button click --name "$2" >/dev/null 2>&1
  sleep 1
  for i in 1 2 3; do
    DISP=$(agent-browser snapshot -i 2>/dev/null | grep -c 'Display name')
    [ "$DISP" = "0" ] && break
    REF=$(agent-browser snapshot -i 2>/dev/null | grep 'button "Sign in"' | grep -v "or create" | grep -o 'ref=[a-z0-9]*' | cut -d= -f2 | head -1)
    [ -n "$REF" ] && agent-browser click @$REF >/dev/null 2>&1
    sleep 1
  done
  agent-browser find label "Email" fill "$1" >/dev/null 2>&1
  agent-browser find label "Password" fill "$DEMO_PASS" >/dev/null 2>&1
  SUBREF=$(agent-browser snapshot -i 2>/dev/null | grep 'lucide-log-in' | grep -o 'ref=[a-z0-9]*' | cut -d= -f2 | head -1)
  if [ -n "$SUBREF" ]; then agent-browser click @$SUBREF >/dev/null 2>&1; else agent-browser find last "button[type=submit]" click >/dev/null 2>&1; fi
  for i in $(seq 1 15); do
    u=$(agent-browser get url 2>/dev/null)
    case "$u" in *"#/auth"*) sleep 1;; *) return 0;; esac
  done
  return 1
}

# ── 1. Teacher: dispute dialog fully rendered, then submit ──
agent-browser set viewport 1440 900 >/dev/null 2>&1
if login "ci2-teacher@bean.test" "Apply to teach"; then log "PASS: teacher signed in"; else log "FAIL: teacher login"; fi
agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
wait_text "Evaluated classes" 20 || log "FAIL: tab"
agent-browser find role button click --name "View" --exact >/dev/null 2>&1
wait_text "Evaluation categories" 20 || log "FAIL: report"
agent-browser find role button click --name "Dispute a finding" >/dev/null 2>&1
if wait_text "never to an AI" 20; then log "PASS: dispute dialog with human-review disclosure"; else log "FAIL: dispute dialog"; fi
if wait_text "judge-" 15; then log "PASS: findings rendered in dialog"; else log "FAIL: findings not rendered"; fi
sleep 1
REF=$(agent-browser snapshot -i 2>/dev/null | grep 'role "radio"' | head -1 | grep -o 'ref=[a-z0-9]*' | cut -d= -f2)
if [ -n "$REF" ]; then agent-browser click @$REF >/dev/null 2>&1 && log "PASS: finding radio selected (ref $REF)"; else log "FAIL: no radio ref"; fi
agent-browser find label "Dispute reason" fill "The lesson notes explicitly describe the planned structure; this finding understates what the evidence shows." >/dev/null 2>&1
sleep 1
SUBREF=$(agent-browser snapshot -i 2>/dev/null | grep 'button "Submit dispute"' | grep -o 'ref=[a-z0-9]*' | cut -d= -f2 | head -1)
if [ -n "$SUBREF" ]; then agent-browser click @$SUBREF >/dev/null 2>&1; else agent-browser find role button click --name "Submit dispute" >/dev/null 2>&1; fi
if wait_text "Your disputes" 15; then log "PASS: disputes section present"; else log "FAIL: disputes section"; fi
sleep 2
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "SUBMITTED" && log "PASS: new dispute listed as SUBMITTED" || log "FAIL: new dispute not created"
shot 1440-teacher-dispute-submitted-b

# ── 2. Teacher: dispute history dialog shows governance wording ──
sleep 2
agent-browser find role button click --name "View status" >/dev/null 2>&1
if wait_text "You cannot change an administrator" 15; then log "PASS: governance wording visible (teacher cannot modify decisions)"; else log "FAIL: governance wording"; fi
if wait_text "append-only" 10; then log "PASS: append-only history visible to the teacher"; else log "FAIL: history"; fi
shot 1440-teacher-dispute-history-b

# ── 3. Admin: review workspace agent-run audit ──
if login "ci2-admin@bean.test" "Learn, prepare for examinations"; then log "PASS: admin signed in"; else log "FAIL: admin login"; fi
agent-browser open "$BASE/#/admin/trust" >/dev/null 2>&1
sleep 2
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
wait_text "Review queue" 20 || log "FAIL: queue"
agent-browser find role button click --name "Review" --exact >/dev/null 2>&1
if wait_text "Agent runs" 20; then log "PASS: agent-run audit visible in review workspace"; else log "FAIL: agent runs"; fi
shot 1440-admin-review-workspace-b

log "=== CI-2A part 2b complete ==="
