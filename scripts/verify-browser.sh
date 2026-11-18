#!/bin/bash
# Phase 2B BROWSER verification (single-session). Log: /tmp/verify/browser.txt
set -u
cd /home/z/my-project
mkdir -p /tmp/verify/shots
L=/tmp/verify/browser.txt
: > "$L"
RUN="$(date +%H%M%S)"
BE="browser$RUN"

log() { echo "$1" >> "$L"; }
step() { echo "--- $1" >> "$L"; }
shot() { agent-browser screenshot "/tmp/verify/shots/$1.png" >/dev/null 2>&1 && echo "shot $1" >> "$L" || echo "SHOT-FAIL $1" >> "$L"; }

# ── dev server ──
setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 http://localhost:3000/ && break; sleep 1; done
curl -s -o /dev/null --max-time 5 http://localhost:3000/ || { log "SERVER FAILED"; exit 1; }
log "server up"

# fresh browser identity
agent-browser cookies clear >/dev/null 2>&1
agent-browser storage local clear >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1

step "1. home renders"
agent-browser open http://localhost:3000/ >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
home=$(agent-browser get text "main" 2>/dev/null | head -c 400)
log "home: $home"
shot 01-home

step "2. create account -> routed to onboarding"
agent-browser open "http://localhost:3000/#/auth" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "Create account" >/dev/null 2>&1
agent-browser find label "Email" fill "$BE@example.com" >/dev/null 2>&1
agent-browser find label "Password" fill "learning123" >/dev/null 2>&1
agent-browser find role button click --name "Create account" >/dev/null 2>&1
sleep 3
url=$(agent-browser get url 2>/dev/null)
log "post-signup url: $url"
ob=$(agent-browser get text "main" 2>/dev/null | head -c 300)
log "onboarding: $ob"
shot 02-onboarding

step "3. onboarding step 1: name + continue"
agent-browser find label "Display name" fill "Bhavya" >/dev/null 2>&1
agent-browser find role button click --name "Continue" >/dev/null 2>&1
sleep 1

step "4. onboarding step 2: category College + level"
agent-browser find text "College" click >/dev/null 2>&1
sleep 1
agent-browser find role button click --name "Continue" >/dev/null 2>&1
sleep 1

step "5. onboarding step 3: interests Physics + Continue"
agent-browser find role button click --name "Physics" >/dev/null 2>&1
sleep 0.5
agent-browser find role button click --name "Continue" >/dev/null 2>&1
sleep 1

step "6. onboarding step 4: language/style/time"
agent-browser find role button click --name "English" >/dev/null 2>&1
agent-browser find role button click --name "Practice first" >/dev/null 2>&1
agent-browser find role button click --name "45 min" >/dev/null 2>&1
agent-browser find role button click --name "Continue" >/dev/null 2>&1
sleep 1

step "7. onboarding step 5: goal + finish"
agent-browser find label "Goal 1 title" fill "Understand calculus basics" >/dev/null 2>&1
shot 03-onboarding-goals
agent-browser find role button click --name "Finish setup" >/dev/null 2>&1
sleep 3
url=$(agent-browser get url 2>/dev/null)
log "post-onboarding url: $url"
dash=$(agent-browser get text "main" 2>/dev/null | head -c 700)
log "dashboard: $dash"
shot 04-dashboard

step "8. dashboard greets + honest sections"
dashall=$(agent-browser get text "main" 2>/dev/null)
echo "$dashall" | grep -q "Hello, Bhavya" && log "PASS greeting" || log "FAIL greeting"
echo "$dashall" | grep -q "Continue learning" && log "PASS continue-learning section" || log "FAIL continue-learning"
echo "$dashall" | grep -q "My goals" && log "PASS goals section" || log "FAIL goals"
echo "$dashall" | grep -q "My progress" && log "PASS progress section" || log "FAIL progress"
echo "$dashall" | grep -q "Next step" && log "PASS recommendations" || log "FAIL recommendations"

step "9. goals view + create/edit/complete"
agent-browser open "http://localhost:3000/#/goals" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
goals=$(agent-browser get text "main" 2>/dev/null)
echo "$goals" | grep -q "Understand calculus basics" && log "PASS onboarding goal listed" || log "FAIL onboarding goal listed"
agent-browser find role button click --name "New goal" >/dev/null 2>&1
agent-browser find label "Goal" fill "Revise biology chapters 1-4" >/dev/null 2>&1
agent-browser find role button click --name "Create goal" >/dev/null 2>&1
sleep 2
goals2=$(agent-browser get text "main" 2>/dev/null)
echo "$goals2" | grep -q "Revise biology chapters 1-4" && log "PASS goal created in UI" || log "FAIL goal created in UI"
echo "$goals2" | grep -q "2 active" && log "PASS goals counter" || log "FAIL goals counter"
shot 05-goals

step "10. workspace view (empty library honest state)"
agent-browser open "http://localhost:3000/#/workspace" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
ws=$(agent-browser get text "main" 2>/dev/null)
echo "$ws" | grep -q "My Learning" && log "PASS workspace header" || log "FAIL workspace header"
echo "$ws" | grep -q "library is empty" && log "PASS workspace honest empty state" || log "FAIL workspace empty state"
shot 06-workspace

step "11. settings: edit profile entry"
agent-browser open "http://localhost:3000/#/settings" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
st=$(agent-browser get text "main" 2>/dev/null)
echo "$st" | grep -q "Edit my profile" && log "PASS settings edit-profile entry" || log "FAIL settings edit-profile"
agent-browser find role button click --name "Edit my profile" >/dev/null 2>&1
sleep 2
ep=$(agent-browser get text "main" 2>/dev/null | head -c 200)
echo "$ep" | grep -q "Your profile" && log "PASS edit-mode onboarding opens" || log "FAIL edit-mode onboarding"

step "12. student blocked from PYQ studio"
agent-browser open "http://localhost:3000/#/pyq-studio" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
ps=$(agent-browser get text "main" 2>/dev/null)
echo "$ps" | grep -q "Not authorised" && log "PASS student 403 panel in studio" || log "FAIL student 403 panel"
shot 07-studio-student-403

step "13. switch to curator (riya from API run)"
agent-browser cookies clear >/dev/null 2>&1
agent-browser storage local clear >/dev/null 2>&1
agent-browser open "http://localhost:3000/#/auth" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find label "Email" fill "riya@example.com" >/dev/null 2>&1
agent-browser find label "Password" fill "curation123" >/dev/null 2>&1
agent-browser find role button click --name "Sign in" >/dev/null 2>&1
sleep 3
url=$(agent-browser get url 2>/dev/null)
log "curator post-signin url: $url"

step "14. curator studio: role + tabs"
agent-browser open "http://localhost:3000/#/pyq-studio" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
ps2=$(agent-browser get text "main" 2>/dev/null)
echo "$ps2" | grep -q "PYQ Studio" && log "PASS studio renders for curator" || log "FAIL studio renders"
echo "$ps2" | grep -q "PYQ_CURATOR" && log "PASS curator role shown" || log "FAIL curator role"
echo "$ps2" | grep -q "Catalogue limitation" && log "PASS honest limitation note" || log "FAIL limitation note"
shot 08-studio

step "15. review queue shows provenance"
agent-browser find role tab click --name "Review queue" >/dev/null 2>&1
sleep 3
rq=$(agent-browser get text "main" 2>/dev/null)
echo "$rq" | grep -q "Verified" && log "PASS verified rows visible" || log "FAIL verified rows"
echo "$rq" | grep -q "Reviewed by" && log "PASS reviewer identity rendered" || log "FAIL reviewer identity"
echo "$rq" | grep -q "answer key fixture" && log "PASS justification rendered" || log "FAIL justification"
echo "$rq" | grep -q "Batch" && log "PASS batch provenance rendered" || log "FAIL batch provenance"
shot 09-studio-review

step "16. import history"
agent-browser find role tab click --name "History" >/dev/null 2>&1
sleep 2
hist=$(agent-browser get text "main" 2>/dev/null)
echo "$hist" | grep -q "QA Demo Course Paper" && log "PASS import history batch" || log "FAIL import history"
shot 10-studio-history

step "17. mobile viewport dashboard"
agent-browser cookies clear >/dev/null 2>&1
agent-browser storage local clear >/dev/null 2>&1
agent-browser set device "iPhone 14" >/dev/null 2>&1
agent-browser open "http://localhost:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
mhome=$(agent-browser get text "main" 2>/dev/null | head -c 150)
log "mobile home: $mhome"
shot 11-mobile-home
agent-browser open "http://localhost:3000/#/auth" >/dev/null 2>&1
sleep 1
mshot=$(agent-browser screenshot /tmp/verify/shots/12-mobile-auth.png >/dev/null 2>&1 && echo ok || echo fail)
log "mobile auth shot: $mshot"
agent-browser set viewport 1440 900 >/dev/null 2>&1

log "BROWSER DONE"
