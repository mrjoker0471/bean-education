#!/bin/bash
# Focused browser check: Verified-status provenance rendering in PYQ studio.
set -u
cd /home/z/my-project
L=/tmp/verify/browser2.txt
: > "$L"
log() { echo "$1" >> "$L"; }

setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 http://localhost:3000/ && break; sleep 1; done
log "server up"

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open "http://localhost:3000/" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser open "http://localhost:3000/#/auth" >/dev/null 2>&1
sleep 1
agent-browser find label "Email" fill "riya@example.com" >/dev/null 2>&1
agent-browser find label "Password" fill "curation123" >/dev/null 2>&1
agent-browser find role button click --name "Sign in" >/dev/null 2>&1
sleep 3

agent-browser open "http://localhost:3000/#/pyq-studio" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser find role tab click --name "Review queue" >/dev/null 2>&1
sleep 2
agent-browser find role button click --name "Verified" >/dev/null 2>&1
sleep 3
vq=$(agent-browser get text "main" 2>/dev/null)
echo "$vq" | grep -q "Reviewed by" && log "PASS reviewer identity on VERIFIED tab" || log "FAIL reviewer identity"
echo "$vq" | grep -q "answer key fixture" && log "PASS justification on VERIFIED tab" || log "FAIL justification"
echo "$vq" | grep -q "Batch" && log "PASS batch provenance on VERIFIED tab" || log "FAIL batch provenance"
echo "$vq" | grep -q "Source ref" && log "PASS sourceRef rendered" || log "FAIL sourceRef"
echo "$vq" | grep -q "PYQ_CURATOR" && log "PASS reviewer role rendered" || log "FAIL reviewer role"
agent-browser screenshot /tmp/verify/shots/13-studio-verified.png >/dev/null 2>&1 && log "shot ok"

# Rejected tab: rejected rows excluded from practice + audit text
agent-browser find role button click --name "Rejected" >/dev/null 2>&1
sleep 2
rj=$(agent-browser get text "main" 2>/dev/null)
echo "$rj" | grep -q "excluded from all practice tests" && log "PASS rejected rows audit note" || log "FAIL rejected audit note"
agent-browser screenshot /tmp/verify/shots/14-studio-rejected.png >/dev/null 2>&1 && log "shot ok"

log "DONE2"
