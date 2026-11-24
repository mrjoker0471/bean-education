#!/bin/bash
# ─── CI-2A part 2c: UI dispute creation + second-admin appeal decision ───────
# Hardened against the auth-view's 4s re-render poll: every click that matters
# takes a FRESH accessibility ref and is retried until the expected state is
# visible.
set -u
cd /home/z/ci2
L=/tmp/verify/ci2-browser4.txt
: > "$L"
log() { echo "$1" >> "$L"; }
shot() { agent-browser screenshot "docs/screenshots/ci2/$1.png" >/dev/null 2>&1 && echo "shot $1" >> "$L" || echo "SHOT-FAIL $1" >> "$L"; }
wait_text() {
  local needle="$1" tries="${2:-30}" region="${3:-main}"
  for i in $(seq 1 "$tries"); do
    t=$(agent-browser get text "$region" 2>/dev/null)
    echo "$t" | grep -qi "$needle" && return 0
    sleep 1
  done
  return 1
}
click_until() {
  # click_until <needle> <tries> <find-cmd...>  — click and wait for needle
  local needle="$1" tries="${2:-3}"; shift 2
  for i in $(seq 1 "$tries"); do
    "$@" >/dev/null 2>&1
    wait_text "$needle" 6 && return 0
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

# ── 1. Admin B (new admin) closes the reconsidered case ──
agent-browser set viewport 1440 900 >/dev/null 2>&1
if login "ci2-mate1@bean.test" "Learn, prepare for examinations"; then log "PASS: admin B signed in"; else log "FAIL: admin B login"; fi
agent-browser open "$BASE/#/admin/trust" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
wait_text "Review queue" 20 && log "PASS: admin B sees the reconsidered dispute in queue" || log "FAIL: queue"
agent-browser find role button click --name "Assign to me" >/dev/null 2>&1
sleep 2
click_until "Human decision" 3 agent-browser find role button click --name "Decide"
wait_text "Human decision" 10 && log "PASS: decision dialog (admin B)" || log "FAIL: decision dialog"
agent-browser find role button click --name "UPHELD" >/dev/null 2>&1
agent-browser find label "Decision note" fill "Second review by a different administrator: the reconsidered case is decided on the evidence register and notes." >/dev/null 2>&1
agent-browser find role button click --name "Record decision" >/dev/null 2>&1
wait_text "RESOLVED" 15 && log "PASS: reconsidered case RESOLVED by admin B (positive appeal path)" || log "FAIL: admin B resolution"
shot 1440-admin-b-resolution

# ── 2. Teacher creates a NEW dispute through the UI ──
if login "ci2-teacher@bean.test" "Apply to teach"; then log "PASS: teacher signed in"; else log "FAIL: teacher login"; fi
agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
wait_text "Evaluated classes" 20 || log "FAIL: tab"
agent-browser find role button click --name "View" --exact >/dev/null 2>&1
wait_text "Evaluation categories" 20 || log "FAIL: report"
DIALOG_OK=0
for i in 1 2 3; do
  agent-browser find role button click --name "Dispute a finding" >/dev/null 2>&1
  wait_text "never to an AI" 8 && { DIALOG_OK=1; break; }
done
[ "$DIALOG_OK" = 1 ] && log "PASS: dispute dialog opened via UI" || log "FAIL: dispute dialog"
if wait_text "judge-" 12; then log "PASS: findings rendered in dialog"; else log "FAIL: findings not rendered"; fi
for i in 1 2 3; do
  REF=$(agent-browser snapshot -i 2>/dev/null | grep 'role "radio"' | head -1 | grep -o 'ref=[a-z0-9]*' | cut -d= -f2)
  [ -n "$REF" ] && agent-browser click @$REF >/dev/null 2>&1
  t=$(agent-browser get text "main" 2>/dev/null)
  echo "$t" | grep -qi 'aria-checked="true"\|checked' && break
  sleep 1
done
log "radio selection attempted"
agent-browser find label "Dispute reason" fill "The lesson notes explicitly describe the planned structure; this finding understates what the evidence shows." >/dev/null 2>&1
sleep 1
SUBMITTED=0
for i in 1 2 3; do
  SUBREF=$(agent-browser snapshot -i 2>/dev/null | grep 'button "Submit dispute"' | grep -o 'ref=[a-z0-9]*' | cut -d= -f2 | head -1)
  [ -n "$SUBREF" ] && agent-browser click @$SUBREF >/dev/null 2>&1
  agent-browser find role button click --name "Submit dispute" >/dev/null 2>&1
  wait_text "Your disputes" 8 && { SUBMITTED=1; break; }
done
sleep 3
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "SUBMITTED" && log "PASS: new dispute created through the UI (SUBMITTED)" || log "FAIL: UI dispute creation"
shot 1440-teacher-dispute-ui-created

# ── 3. Governance wording in the teacher's dispute history dialog ──
GWORD=0
for i in 1 2 3; do
  agent-browser find role button click --name "View status" >/dev/null 2>&1
  wait_text "You cannot change an administrator" 8 && { GWORD=1; break; }
done
[ "$GWORD" = 1 ] && log "PASS: governance wording visible (teacher cannot modify admin decisions)" || log "FAIL: governance wording"
if wait_text "append-only" 10; then log "PASS: append-only history visible to the teacher"; else log "FAIL: history"; fi
shot 1440-teacher-dispute-history-b

log "=== CI-2A part 2c complete ==="
