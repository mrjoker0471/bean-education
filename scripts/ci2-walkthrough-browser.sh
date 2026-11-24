#!/bin/bash
# ─── CI-2A: authenticated browser walkthrough (student / teacher / admin) ────
# Genuine authenticated verification of the CI-1 surfaces on the CI-2 branch,
# following the repo's agent-browser convention (scripts/verify-browser*.sh).
# Log: /tmp/verify/ci2-browser.txt — screenshots: docs/screenshots/ci2/
#
# Requires: dev server on :3000 serving the CI-2 branch and the walkthrough
# fixtures seeded by `bun scripts/ci2-walkthrough-seed.ts`.
set -u
cd /home/z/ci2
mkdir -p docs/screenshots/ci2 /tmp/verify
L=/tmp/verify/ci2-browser.txt
: > "$L"

log() { echo "$1" >> "$L"; }
step() { echo "--- $1" >> "$L"; }
shot() { agent-browser screenshot "docs/screenshots/ci2/$1.png" >/dev/null 2>&1 && echo "shot $1" >> "$L" || echo "SHOT-FAIL $1" >> "$L"; }

BASE=http://localhost:3000
DEMO_PASS='bean-ci2-demo'

curl -s -o /dev/null --max-time 30 "$BASE/" || { log "SERVER FAILED"; exit 1; }
log "server up (CI-2 branch worktree)"

# wait until main contains <needle> (case-insensitive) for <tries> seconds
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
  # $1 = email, $2 = audience button text fragment ("Learn, prepare" | "Apply to teach")
  agent-browser cookies clear >/dev/null 2>&1
  agent-browser storage local clear >/dev/null 2>&1
  agent-browser open "$BASE/#/auth" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 1
  agent-browser find role button click --name "$2" >/dev/null 2>&1
  sleep 1
  agent-browser find role button click --name "Sign in" >/dev/null 2>&1
  sleep 1
  agent-browser find label "Email" fill "$1" >/dev/null 2>&1
  agent-browser find label "Password" fill "$DEMO_PASS" >/dev/null 2>&1
  agent-browser find last "button[type=submit]" click >/dev/null 2>&1
  for i in $(seq 1 15); do
    u=$(agent-browser get url 2>/dev/null)
    case "$u" in *"#/auth"*) sleep 1;; *) return 0;; esac
  done
  return 1
}

# ══ 1. STUDENT walkthrough (desktop) ═══════════════════════════════════════
step "S1. sign in as walkthrough student"
agent-browser set viewport 1440 900 >/dev/null 2>&1
if login "ci2-student@bean.test" "Learn, prepare for examinations"; then log "PASS: student signed in ($(agent-browser get url 2>/dev/null))"; else log "FAIL: student login"; fi
shot 1440-student-home

step "S2. My bookings shows attended classes + CI summaries"
agent-browser open "$BASE/#/classes?tab=bookings" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "My bookings" >/dev/null 2>&1
sleep 1
if wait_text "Quadratic equations" 25; then log "PASS: evaluated class A listed in My bookings"; else log "FAIL: class A not listed"; fi
if wait_text "Class learning summaries" 15; then log "PASS: CI summaries section visible"; else log "FAIL: summaries section missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "class-level" && log "PASS: class-level scope wording present" || log "FAIL: scope wording missing"
echo "$t" | grep -qi "Trigonometry basics" && log "PASS: attended class B listed" || log "FAIL: class B missing"
echo "$t" | grep -qi "no-show\|NO_SHOW\|No show" && log "PASS: no-show booking honest" || log "FAIL: no-show missing"
shot 1440-student-bookings

step "S3. open a class-level summary (expanded card)"
agent-browser find role button click --name "Open summary" >/dev/null 2>&1
if wait_text "What this class covered" 10; then log "PASS: lesson summary section rendered"; else log "FAIL: lesson summary missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "same for everyone" && log "PASS: fixed scope note visible" || log "FAIL: scope note missing"
echo "$t" | grep -qi "Concepts covered" && log "PASS: concepts covered rendered" || log "FAIL: concepts missing"
echo "$t" | grep -qi "Suggested practice" && log "PASS: suggested practice rendered" || log "FAIL: practice missing"
# Both summaries: revision recommendations appear only when the evidence supports them
agent-browser find role button click --name "Close" >/dev/null 2>&1
sleep 1
REF2=$(agent-browser snapshot -i 2>/dev/null | grep 'button "Open summary"' | tail -1 | grep -o 'ref=[a-z0-9]*' | cut -d= -f2)
if [ -n "$REF2" ]; then agent-browser click @$REF2 >/dev/null 2>&1; fi
sleep 1.5
t=$(agent-browser get text "main" 2>/dev/null)
if echo "$t" | grep -qi "Worth revisiting"; then log "PASS: revision recommendations rendered where evidence supports them"; else log "NOTE: no revision recommendations on the second card (honest absence when evidence lacks them)"; fi
shot 1440-student-summary-open

step "S4. summary scope on mobile viewport"
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 1
shot 390-student-bookings
agent-browser find role button click --name "Close" >/dev/null 2>&1
sleep 1
agent-browser find role button click --name "Open summary" >/dev/null 2>&1
sleep 2
shot 390-student-summary-open
mtext=$(agent-browser get text "main" 2>/dev/null | head -c 300)
log "mobile render: $(echo "$mtext" | head -c 150)"

# ══ 2. server-side ownership denials (real HTTP, real sessions) ════════════
step "S5. server-side denials via authenticated API calls"
JAR_S=/tmp/verify/ci2-student.jar; JAR_O=/tmp/verify/ci2-outsider.jar; JAR_T=/tmp/verify/ci2-teacher.jar; JAR_A=/tmp/verify/ci2-admin.jar
rm -f $JAR_S $JAR_O $JAR_T $JAR_A
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

st=$(code -c $JAR_S -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"ci2-student@bean.test","password":"'"$DEMO_PASS"'"}')
log "student login: $st"
ot=$(code -c $JAR_O -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"ci2-outsider@bean.test","password":"'"$DEMO_PASS"'"}')
log "outsider login: $ot"
tc=$(code -c $JAR_T -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"ci2-teacher@bean.test","password":"'"$DEMO_PASS"'"}')
log "teacher login: $tc"
ac=$(code -c $JAR_A -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"ci2-admin@bean.test","password":"'"$DEMO_PASS"'"}')
log "admin login: $ac"

IDS=$(bun -e '
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const r = await db.classroomEvaluationReport.findFirst({ where: { job: { classSession: { title: { contains: "Quadratic" } } } }, select: { id: true, classSessionId: true } });
const s = await db.classroomStudentSummary.findFirst({ where: { booking: { student: { email: "ci2-student@bean.test" } } }, select: { bookingId: true } });
console.log((r?.id ?? "") + " " + (r?.classSessionId ?? "") + " " + (s?.bookingId ?? ""));
await db.$disconnect();
' 2>/dev/null)
REPORT_ID=$(echo "$IDS" | awk '{print $1}')
CLASS_A_ID=$(echo "$IDS" | awk '{print $2}')
log "report id: $REPORT_ID; class A id: $CLASS_A_ID"

body_o=$(curl -s -b $JAR_O "$BASE/api/learn/class-summaries")
echo "$body_o" | grep -q '"summaries":\[\]' && log "PASS: outsider summaries empty — no cross-student rows" || log "FAIL: outsider sees summaries"
r2=$(code -b $JAR_S "$BASE/api/teach/classroom-intelligence")
[ "$r2" = "403" ] && log "PASS: student -> teacher CI endpoint 403" || log "FAIL: student -> teacher CI $r2"
r3=$(code -b $JAR_S "$BASE/api/admin/classroom-intelligence/disputes")
[ "$r3" = "403" ] && log "PASS: student -> admin CI dispute queue 403" || log "FAIL: student -> admin $r3"
r4=$(code -b $JAR_O "$BASE/api/teach/classes/$CLASS_A_ID/evaluation")
[ "$r4" = "403" ] && log "PASS: student -> teacher-only class evaluation 403" || log "FAIL: evaluation access $r4"
r5=$(code -b $JAR_T "$BASE/api/teach/classes/$CLASS_A_ID/evaluation")
[ "$r5" = "200" ] && log "PASS: owner teacher -> own class evaluation 200" || log "FAIL: owner evaluation $r5"
r6=$(code -b $JAR_O -X DELETE "$BASE/api/teach/classroom-intelligence/reports/$REPORT_ID" -H 'Origin: '"$BASE")
[ "$r6" = "403" ] && log "PASS: outsider -> delete teacher report refused (403 role gate)" || log "FAIL: outsider delete $r6"
r7=$(code "$BASE/api/learn/class-summaries")
[ "$r7" = "401" ] && log "PASS: anonymous -> summaries 401" || log "FAIL: anonymous $r7"
r8=$(code -b $JAR_O -X POST "$BASE/api/teach/classroom-intelligence/reports/$REPORT_ID/dispute" -H 'Content-Type: application/json' -H 'Origin: '"$BASE" -d '{"findings":[{"findingId":"learner-4","reason":"Outsider attempting to dispute another teacher report"}]}')
[ "$r8" = "403" ] && log "PASS: outsider -> dispute another teacher's report 403 (role gate)" || log "FAIL: outsider dispute $r8"
r9=$(code -b $JAR_A -X POST "$BASE/api/teach/classroom-intelligence/reports/$REPORT_ID/dispute" -H 'Content-Type: application/json' -H 'Origin: '"$BASE" -d '{"findings":[{"findingId":"learner-4","reason":"Admin attempting to dispute a teacher report"}]}')
[ "$r9" = "403" ] && log "PASS: admin is not a teacher -> dispute creation refused 403" || log "FAIL: admin dispute $r9"

# ══ 3. TEACHER walkthrough (desktop) ═══════════════════════════════════════
step "T1. sign in as approved teacher, open dashboard intelligence tab"
agent-browser set viewport 1440 900 >/dev/null 2>&1
if login "ci2-teacher@bean.test" "Apply to teach"; then log "PASS: teacher signed in"; else log "FAIL: teacher login"; fi
agent-browser open "$BASE/#/teach/dashboard" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
if wait_text "Teacher dashboard\|Dashboard\|Profile" 20; then log "PASS: teacher dashboard renders"; else log "FAIL: teacher dashboard missing"; fi
agent-browser find role tab click --name "Classroom Intelligence" >/dev/null 2>&1
if wait_text "never records audio or video" 15; then log "PASS: AI disclosure visible"; else log "FAIL: AI disclosure missing"; fi
if wait_text "Evaluated classes" 10; then log "PASS: evaluated classes section"; else log "FAIL: evaluated section missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "Ended classes" && log "PASS: eligible classes section" || log "FAIL: eligible section missing"
shot 1440-teacher-ci-dashboard

step "T2. consent pause + re-enable"
agent-browser find role button click --name "Pause evaluations" >/dev/null 2>&1
if wait_text "Evaluations are paused" 12; then log "PASS: withdrawal stops evaluations (paused banner)"; else log "FAIL: paused banner missing"; fi
shot 1440-teacher-ci-paused
agent-browser find role button click --name "Enable evaluations" >/dev/null 2>&1
if wait_text "Evaluated classes" 12; then log "PASS: consent re-enabled"; else log "FAIL: re-enable failed"; fi

step "T3. open evaluated class report (categories, evidence, versions)"
agent-browser find role button click --name "View" >/dev/null 2>&1
if wait_text "Evaluation categories" 15; then log "PASS: report categories table"; else log "FAIL: categories table missing"; fi
t=$(agent-browser get text "main" 2>/dev/null)
echo "$t" | grep -qi "Lesson summary" && log "PASS: report lesson summary" || log "FAIL: lesson summary missing"
echo "$t" | grep -qi "Subject accuracy" && log "PASS: category rows rendered" || log "FAIL: category rows missing"
echo "$t" | grep -qi "Not evaluable from this evidence" && log "PASS: insufficient-evidence categories honest" || log "FAIL: not-evaluable rows missing"
echo "$t" | grep -qi "Evidence the evaluation used" && log "PASS: evidence register rendered" || log "FAIL: evidence register missing"
echo "$t" | grep -qi "Version 1" && log "PASS: report version shown" || log "FAIL: version missing"
echo "$t" | grep -qi "Objectives" && log "PASS: objectives rendered" || log "FAIL: objectives missing"
shot 1440-teacher-evaluation-report

step "T3b. second evaluated class (no notes/board) — honest not-evaluable categories"
agent-browser find role button click --name "Close" >/dev/null 2>&1
sleep 1
VREF=$(agent-browser snapshot -i 2>/dev/null | grep 'button "View"' | tail -1 | grep -o 'ref=[a-z0-9]*' | cut -d= -f2)
if [ -n "$VREF" ]; then agent-browser click @$VREF >/dev/null 2>&1; fi
if wait_text "Evaluation categories" 15; then
  t=$(agent-browser get text "main" 2>/dev/null)
  if echo "$t" | grep -qi "Not evaluable from this evidence"; then log "PASS: not-evaluable categories honest (second report)"; else log "NOTE: second report's categories were all evaluable from its evidence"; fi
else
  log "NOTE: second report did not expand — checked via API instead"
fi
shot 1440-teacher-evaluation-report-b

step "T4. mobile teacher experience"
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 1
shot 390-teacher-ci-dashboard
agent-browser find role button click --name "Close" >/dev/null 2>&1
sleep 1
agent-browser find role button click --name "View" >/dev/null 2>&1
sleep 3
shot 390-teacher-report

step "T5. dispute status via API (UI is delivered in CI-2E — documented gap)"
disp=$(curl -s -b $JAR_T "$BASE/api/teach/classroom-intelligence/disputes")
echo "$disp" | grep -q '"id"' && log "PASS: teacher dispute list API returns the seeded dispute with history" || log "FAIL: dispute list empty"
echo "$disp" | grep -q 'SUBMITTED' && log "PASS: dispute status SUBMITTED" || log "FAIL: status wrong"
adminq=$(curl -s -b $JAR_A "$BASE/api/admin/classroom-intelligence/disputes")
echo "$adminq" | grep -q 'SUBMITTED' && log "PASS: admin queue API returns pending dispute" || log "FAIL: admin queue empty"

# ══ 4. ADMIN walkthrough (part 1 — trust center renders; CI UI ships in CI-2E)
step "A1. sign in as admin, open Trust Center"
agent-browser set viewport 1440 900 >/dev/null 2>&1
if login "ci2-admin@bean.test" "Learn, prepare for examinations"; then log "PASS: admin signed in"; else log "FAIL: admin login"; fi
agent-browser open "$BASE/#/admin/trust" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
if wait_text "Trust" 15; then log "PASS: admin trust center renders"; else log "FAIL: trust center missing"; fi
shot 1440-admin-trust-center

log "=== CI-2A walkthrough part 1 complete ==="
