#!/bin/bash
# Focused browser check v2 — snapshot-ref based sign-in for provenance rendering.
set -u
cd /home/z/my-project
L=/tmp/verify/browser3.txt
: > "$L"
log() { echo "$1" >> "$L"; }

setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 http://localhost:3000/ && break; sleep 1; done
log "server up"

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser cookies clear >/dev/null 2>&1
agent-browser storage local clear >/dev/null 2>&1
agent-browser open "http://localhost:3000/#/auth" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2

# Fill by refs from snapshot
refs=$(agent-browser snapshot -i 2>/dev/null)
emailref=$(echo "$refs" | grep 'textbox "Email"' | grep -oE 'ref=e[0-9]+' | grep -oE 'e[0-9]+' | head -1)
passref=$(echo "$refs" | grep 'textbox "Password"' | grep -oE 'ref=e[0-9]+' | grep -oE 'e[0-9]+' | head -1)
log "email=$emailref pass=$passref"
agent-browser fill "@$emailref" "riya@example.com" >/dev/null 2>&1
agent-browser fill "@$passref" "curation123" >/dev/null 2>&1

# Click the FORM's submit button (inside the card, not the header) via eval
agent-browser eval "document.querySelector('form button[type=submit], form button')?.click()" >/dev/null 2>&1
sleep 4
url=$(agent-browser get url 2>/dev/null)
log "post-signin url: $url"
me=$(curl -s http://localhost:3000/api/auth/me 2>/dev/null | head -c 120)
log "(server-side me: $me)"

agent-browser open "http://localhost:3000/#/pyq-studio" >/dev/null 2>&1
sleep 2
agent-browser find role tab click --name "Review queue" >/dev/null 2>&1
sleep 3
agent-browser eval "document.querySelector('button[aria-pressed=true]')?.textContent" >/dev/null 2>&1
# click the Verified status chip by role+name
agent-browser eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Verified'))?.click()" >/dev/null 2>&1
sleep 3
vq=$(agent-browser get text "main" 2>/dev/null)
echo "$vq" | grep -q "Reviewed by" && log "PASS reviewer identity on VERIFIED tab" || log "FAIL reviewer identity"
echo "$vq" | grep -q "answer key fixture" && log "PASS justification on VERIFIED tab" || log "FAIL justification"
echo "$vq" | grep -q "Batch" && log "PASS batch provenance on VERIFIED tab" || log "FAIL batch provenance"
echo "$vq" | grep -q "Source ref" && log "PASS sourceRef rendered" || log "FAIL sourceRef"
agent-browser screenshot /tmp/verify/shots/13-studio-verified.png >/dev/null 2>&1 && log "shot ok"

agent-browser eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Rejected'))?.click()" >/dev/null 2>&1
sleep 2
rj=$(agent-browser get text "main" 2>/dev/null)
echo "$rj" | grep -q "excluded from all practice tests" && log "PASS rejected rows audit note" || log "FAIL rejected audit note"
agent-browser screenshot /tmp/verify/shots/14-studio-rejected.png >/dev/null 2>&1 && log "shot ok"

log "DONE3"
