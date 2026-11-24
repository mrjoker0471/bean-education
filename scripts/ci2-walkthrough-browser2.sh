#!/bin/bash
# ─── CI-2A part 2: dispute + administrator review browser walkthrough ────────
# Teacher: create a dispute through the REAL UI, inspect status/history,
#          request reconsideration (the appeal).
# Admin:   Trust Center → Classroom Intelligence tab → queue → review
#          workspace (original evaluation + evidence register) → human
#          decision (UPHELD) → append-only history.
# Governance in the browser: the original decision-maker is server-barred from
# reviewing the reconsideration; the teacher UI offers no way to modify an
# administrator decision. Log: /tmp/verify/ci2-browser2.txt
set -u
cd /home/z/ci2
L=/tmp/verify/ci2-browser2.txt
: > "$L"
log() { echo "$1" >> "$L"; }
step() { echo "--- $1" >> "$L"; }
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
log "server up"

login() {
  # $1 = email, $2 = audience button text fragment
  # The auth view re-renders on a 4s google-status poll, which can detach
  # elements between find() and click() — so every interaction below takes a
  # FRESH accessibility ref from a new snapshot, and the panel switch is
  # verified (the "Display name" field only exists on the create panel).
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

# ══ 1. ADMIN: resolve the seeded dispute through the review UI ═════════════
step "A1. admin opens the Trust Center Classroom Intelligence tab"
agent-browser set viewport 1440 900 >/dev/null 2>&1
if login "ci2-admin@bean.test" "Learn, prepare for examinations"; then log "PASS: admin signed in"; else log "FAIL: admin login"; fi
agent-browser open "$BASE/#/admin/trust" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
if wait_text "Trust Center" 15; then log "PASS: trust center renders"; else log "FAIL: trust center"; fi
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "Review queue" 15; then log "PASS: CI dispute queue renders"; else log "FAIL: CI dispute queue missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "Quadratic equations" && log "PASS: seeded dispute listed with class reference" || log "FAIL: seeded dispute missing"
echo "$t" | grep -qi "SUBMITTED" && log "PASS: dispute status SUBMITTED" || log "FAIL: status missing"
shot 1440-admin-ci-queue

step "A2. review workspace: original evaluation + evidence register"
agent-browser find role button click --name "Review" --exact >/dev/null 2>&1
if wait_text "Original evaluation and evidence" 15; then log "PASS: review workspace opens"; else log "FAIL: workspace missing"; fi
if wait_text "Evidence register" 12; then log "PASS: evidence register visible"; else log "FAIL: evidence register missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "learner-4" && log "PASS: original finding ids visible" || log "FAIL: finding ids missing"
echo "$t" | grep -qi "Agent runs" && log "PASS: agent-run audit visible" || log "FAIL: agent runs missing"
echo "$t" | grep -qi "Case history" && log "PASS: append-only history visible" || log "FAIL: history missing"
shot 1440-admin-review-workspace

step "A3. human decision: assign + resolve UPHELD with a documented note"
agent-browser find role button click --name "Assign to me" >/dev/null 2>&1
sleep 2
agent-browser find role button click --name "Review" --exact >/dev/null 2>&1
sleep 2
agent-browser find role button click --name "Decide" >/dev/null 2>&1
if wait_text "Human decision" 10; then log "PASS: decision dialog opens"; else log "FAIL: decision dialog missing"; fi
agent-browser find role button click --name "UPHELD" >/dev/null 2>&1
agent-browser find label "Decision note" fill "Human review: the finding is grounded in the lesson plan and the teacher notes; it stands." >/dev/null 2>&1
agent-browser find role button click --name "Record decision" >/dev/null 2>&1
sleep 3
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "RESOLVED" && log "PASS: dispute now RESOLVED (UPHELD)" || log "FAIL: resolution missing"
echo "$t" | grep -qi "Closed" && log "PASS: dispute moved to Closed section" || log "FAIL: closed section missing"
shot 1440-admin-ci-decision-recorded

# ══ 2. TEACHER: create a NEW dispute through the UI ════════════════════════
step "T1. teacher opens the evaluated report and the dispute dialog"
if login "ci2-teacher@bean.test" "Apply to teach"; then log "PASS: teacher signed in"; else log "FAIL: teacher login"; fi
agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "Evaluated classes" 15; then log "PASS: intelligence tab opens"; else log "FAIL: tab missing"; fi
agent-browser find role button click --name "View" >/dev/null 2>&1
if wait_text "Evaluation categories" 15; then log "PASS: report open"; else log "FAIL: report missing"; fi
agent-browser find role button click --name "Dispute a finding" >/dev/null 2>&1
if wait_text "never to an AI" 12; then log "PASS: dispute dialog opens with human-review disclosure"; else log "FAIL: dispute dialog missing"; fi
shot 1440-teacher-dispute-dialog

step "T2. submit the dispute against a real finding"
REF=$(agent-browser snapshot -i 2>/dev/null | grep 'role "radio"' | head -1 | grep -o 'ref=[a-z0-9]*' | cut -d= -f2)
if [ -n "$REF" ]; then agent-browser click @$REF >/dev/null 2>&1; fi
agent-browser find label "Dispute reason" fill "The lesson notes explicitly describe the planned structure; this finding understates what the evidence shows." >/dev/null 2>&1
agent-browser find role button click --name "Submit dispute" >/dev/null 2>&1
sleep 3
if wait_text "Your disputes" 12; then log "PASS: disputes section present"; else log "FAIL: disputes section missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "SUBMITTED" && log "PASS: new dispute listed as SUBMITTED" || log "FAIL: new dispute missing"
shot 1440-teacher-dispute-submitted

step "T3. teacher cannot modify an administrator decision (no controls exist)"
sleep 2
agent-browser find role button click --name "View status" >/dev/null 2>&1
if wait_text "append-only" 12; then log "PASS: dispute history dialog opens"; else log "FAIL: history dialog missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "You cannot change an administrator" && log "PASS: governance wording visible (no decision controls)" || log "FAIL: governance wording missing"
shot 1440-teacher-dispute-history

# ══ 3. ADMIN resolves the new dispute; TEACHER reconsiders; SEPARATION ═════
step "A4. admin resolves the new dispute (UPHELD)"
login "ci2-admin@bean.test" "Learn, prepare for examinations" >/dev/null 2>&1
agent-browser open "$BASE/#/admin/trust" >/dev/null 2>&1
sleep 2
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "Review queue" 15; then log "PASS: queue shows pending dispute"; else log "FAIL: queue empty"; fi
agent-browser find role button click --name "Assign to me" >/dev/null 2>&1
sleep 2
agent-browser find role button click --name "Review" --exact >/dev/null 2>&1
sleep 2
agent-browser find role button click --name "Decide" >/dev/null 2>&1
sleep 1
agent-browser find role button click --name "UPHELD" >/dev/null 2>&1
agent-browser find label "Decision note" fill "Second human review: the evidence register and notes support the finding as written." >/dev/null 2>&1
agent-browser find role button click --name "Record decision" >/dev/null 2>&1
sleep 3
if wait_text "RESOLVED" 12; then log "PASS: second dispute RESOLVED (UPHELD)"; else log "FAIL: second resolution missing"; fi

step "T4. teacher requests the reconsideration (the appeal)"
login "ci2-teacher@bean.test" "Apply to teach" >/dev/null 2>&1
agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
sleep 2
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "Your disputes" 15; then log "PASS: disputes section"; else log "FAIL: disputes section"; fi
agent-browser find role button click --name "View & reconsider" >/dev/null 2>&1
if wait_text "Grounds for reconsideration" 12; then log "PASS: reconsider affordance for closed dispute"; else log "FAIL: reconsider missing"; fi
agent-browser find label "Reconsideration note" fill "Requesting a second review: the notes describe the full structure and the finding should be re-examined." >/dev/null 2>&1
agent-browser find role button click --name "Request reconsideration" >/dev/null 2>&1
sleep 3
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "SUBMITTED" && log "PASS: dispute back to SUBMITTED after reconsideration" || log "FAIL: reconsider state missing"

step "A5. reviewer separation: the original decider is refused in the UI"
login "ci2-admin@bean.test" "Learn, prepare for examinations" >/dev/null 2>&1
agent-browser open "$BASE/#/admin/trust" >/dev/null 2>&1
sleep 2
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "Review queue" 15; then log "PASS: reconsidered dispute back in queue"; else log "FAIL: queue state"; fi
agent-browser find role button click --name "Assign to me" >/dev/null 2>&1
sleep 3
t=$(agent-browser get text "body" 2>/dev/null)
echo "$t" | grep -qi "cannot review this reconsideration\|Action refused" && log "PASS: original decision-maker server-barred (honest refusal shown)" || log "FAIL: refusal not surfaced"
shot 1440-admin-reviewer-separation-refusal

step "T5. mobile teacher dispute experience"
login "ci2-teacher@bean.test" "Apply to teach" >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
sleep 2
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "Your disputes" 15; then log "PASS: disputes reachable on mobile"; else log "FAIL: mobile disputes"; fi
shot 390-teacher-disputes

log "=== CI-2A part 2 complete ==="
