#!/usr/bin/env bash
# ─── CI-6 real-browser verification walkthrough (uncommitted local tooling) ───
# Drives the PRODUCTION standalone server on an isolated disposable DB with
# clearly-labelled fixture accounts, capturing genuine screenshots of every
# charter-required surface at desktop/tablet/mobile widths. Nothing here is a
# real expert, credential, verification or approval — the DB is disposable.
set -u
BASE="http://127.0.0.1:3100"
SHOTS="docs/screenshots/ci6-verify"
mkdir -p "$SHOTS" /tmp/verify
LOG=/tmp/verify/ci6-browser.txt
: > "$LOG"

log() { echo "[$(date +%H:%M:%S)] $1" | tee -a "$LOG"; }
shot() { agent-browser screenshot "$SHOTS/$1.png" >> "$LOG" 2>&1 && log "shot: $1"; }
wait_text() { # wait_text <needle> <ref-descriptor>
  local needle="$1" desc="$2" i=0
  while [ $i -lt 40 ]; do
    if agent-browser get text main 2>>"$LOG" | grep -q "$needle"; then log "found: $desc"; return 0; fi
    i=$((i+1)); sleep 0.5
  done
  log "MISS: $desc (needle: $needle)"; return 1
}

log "=== CI-6 walkthrough start ==="

# ── 1. Applicant: application form (claim invitation first) ──────────────────
agent-browser open "$BASE/#/auth" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
agent-browser snapshot -i >> "$LOG" 2>&1
agent-browser find label "Email" fill "ci6-applicant@bean.test" >> "$LOG" 2>&1 || true
agent-browser find label "Password" fill "bean-ci6-demo" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-auth.txt 2>&1
REF=$(grep -oE 'ref=[a-z0-9-]+[^"]*name="[^"]*Sign in[^"]*"' /tmp/verify/snap-auth.txt | head -1 | sed 's/ref=\([a-z0-9-]*\).*/\1/')
[ -z "$REF" ] && REF=$(grep -B2 -A2 'Sign in' /tmp/verify/snap-auth.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1
sleep 2
# legal gate if shown
agent-browser snapshot -i > /tmp/verify/snap-gate.txt 2>&1
if grep -q "Accept both" /tmp/verify/snap-gate.txt; then
  REF2=$(grep -oE 'ref=[a-z0-9-]+' /tmp/verify/snap-gate.txt | tail -1 | sed 's/ref=//')
  agent-browser click "$REF2" >> "$LOG" 2>&1; sleep 1
  log "legal gate accepted"
fi
wait_text "Expert reviewer application" "expert apply view"
agent-browser set viewport 1440 900 >> "$LOG" 2>&1
shot "wt-expert-apply-1440"

# ── 2. Admin: create invitation (one-time reveal) ────────────────────────────
log "=== admin: invitation creation ==="
agent-browser open "$BASE/#/auth" >> "$LOG" 2>&1; sleep 1
agent-browser snapshot -i > /tmp/verify/snap-out.txt 2>&1
# sign out via settings? Simplest: clear cookies and re-login as admin
agent-browser cookies clear >> "$LOG" 2>&1
agent-browser open "$BASE/#/auth" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
agent-browser find label "Email" fill "ci6-admin@bean.test" >> "$LOG" 2>&1 || true
agent-browser find label "Password" fill "bean-ci6-demo" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-auth2.txt 2>&1
REF=$(grep -oE 'ref=[a-z0-9-]+' /tmp/verify/snap-auth2.txt | head -1 | sed 's/ref=//')
# click the submit button near the password field (lucide log-in icon)
agent-browser snapshot -i > /tmp/verify/snap-auth3.txt 2>&1
REF=$(grep -E 'button.*[Ss]ign|lucide-log' /tmp/verify/snap-auth3.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1
sleep 2
agent-browser open "$BASE/#/admin/ci5-reviewers" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
wait_text "Verification" "admin governance tabs"
agent-browser snapshot -i > /tmp/verify/snap-admin.txt 2>&1
VREF=$(grep -E 'tab.*[Vv]erification|Verification' /tmp/verify/snap-admin.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$VREF" >> "$LOG" 2>&1; sleep 1
wait_text "Expert invitations" "invitations section"
shot "wt-admin-invitations-1440"
agent-browser find label "Requested domains (comma-separated, advisory)" fill "mathematics-statistics" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-inv.txt 2>&1
CREF=$(grep -E 'Create invitation' /tmp/verify/snap-inv.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$CREF" >> "$LOG" 2>&1; sleep 1
wait_text "Shown exactly once" "one-time token reveal"
shot "wt-admin-invitation-reveal-1440"
# extract the raw token from the DOM text for the claim step
CLAIM=$(agent-browser get text main 2>>"$LOG" | grep -oE '#/expert-apply\?invite=[A-Za-z0-9_-]+' | head -1)
log "claim link extracted: ${CLAIM:0:40}..."

# ── 3. Admin: verification queue + workbench decision on the CI-5-style fixture? ─
# (The applicant has not applied yet — capture the empty queue honestly.)
shot "wt-admin-verification-queue-1440"
agent-browser open "$BASE/#/admin/ci5-reviewers" >> "$LOG" 2>&1; sleep 1
shot "wt-admin-reporting-1440"

# ── 4. Applicant: claim + apply + evidence ───────────────────────────────────
log "=== applicant: claim + apply ==="
agent-browser cookies clear >> "$LOG" 2>&1
agent-browser open "$BASE/$CLAIM" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
agent-browser find label "Email" fill "ci6-applicant@bean.test" >> "$LOG" 2>&1 || true
agent-browser find label "Password" fill "bean-ci6-demo" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-auth4.txt 2>&1
REF=$(grep -E 'button.*[Ss]ign|lucide-log' /tmp/verify/snap-auth4.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1
sleep 2
agent-browser open "$BASE/$CLAIM" >> "$LOG" 2>&1; sleep 1
wait_text "You were invited" "invite banner"
agent-browser snapshot -i > /tmp/verify/snap-claim.txt 2>&1
CREF=$(grep -E 'Claim invitation' /tmp/verify/snap-claim.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$CREF" >> "$LOG" 2>&1; sleep 1
wait_text "Invitation claimed" "claim success"
shot "wt-expert-claim-1440"
# application form step 1
wait_text "Step 1 of 3" "application step 1"
agent-browser find label "Specialties (comma-separated, up to 12)" fill "number theory, algebraic geometry" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-step1.txt 2>&1
REF=$(grep -E 'Continue' /tmp/verify/snap-step1.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1; sleep 1
wait_text "Step 2 of 3" "application step 2"
agent-browser find label "Qualification summary" fill "PhD Mathematics (fixture)" >> "$LOG" 2>&1 || true
agent-browser find label "Institution / professional affiliation" fill "Fixture University (clearly-labelled synthetic)" >> "$LOG" 2>&1 || true
agent-browser find label "Issuing body" fill "Fixture Registry (synthetic)" >> "$LOG" 2>&1 || true
agent-browser find label "Professional experience" fill "Fixture experience text for the walkthrough — 10 years teaching." >> "$LOG" 2>&1 || true
agent-browser find label "Conflict-of-interest declaration" fill "none declared" >> "$LOG" 2>&1 || true
shot "wt-expert-apply-step2-1440"
agent-browser snapshot -i > /tmp/verify/snap-step2.txt 2>&1
REF=$(grep -E 'Review application' /tmp/verify/snap-step2.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1; sleep 1
wait_text "Step 3 of 3" "review + consent step"
shot "wt-expert-review-consent-1440"
agent-browser snapshot -i > /tmp/verify/snap-step3.txt 2>&1
agent-browser find label "Consent to credential verification and reviewer process" check >> "$LOG" 2>&1 || true
REF=$(grep -E 'Submit application' /tmp/verify/snap-step3.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1; sleep 2
wait_text "pending credential verification" "application status"
shot "wt-expert-status-1440"
# evidence upload (fixture PDF)
printf '%%PDF-1.4\n%% fixture evidence for walkthrough\n' > /tmp/verify/fixture-evidence.pdf
agent-browser find label "Evidence file" upload /tmp/verify/fixture-evidence.pdf >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-ev.txt 2>&1
REF=$(grep -E 'Upload' /tmp/verify/snap-ev.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1; sleep 1
wait_text "ACTIVE" "evidence row"
shot "wt-expert-evidence-1440"

# ── 5. Admin: verify + qualify + activate + assign ────────────────────────────
log "=== admin: verification workbench ==="
agent-browser cookies clear >> "$LOG" 2>&1
agent-browser open "$BASE/#/auth" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
agent-browser find label "Email" fill "ci6-admin@bean.test" >> "$LOG" 2>&1 || true
agent-browser find label "Password" fill "bean-ci6-demo" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-auth5.txt 2>&1
REF=$(grep -E 'button.*[Ss]ign|lucide-log' /tmp/verify/snap-auth5.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1; sleep 2
agent-browser open "$BASE/#/admin/ci5-reviewers" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
agent-browser snapshot -i > /tmp/verify/snap-admin2.txt 2>&1
VREF=$(grep -E 'tab.*[Vv]erification' /tmp/verify/snap-admin2.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$VREF" >> "$LOG" 2>&1; sleep 1
wait_text "ci6-applicant@bean.test" "queue row with account association"
agent-browser snapshot -i > /tmp/verify/snap-queue.txt 2>&1
QREF=$(grep -E 'ci6-applicant' /tmp/verify/snap-queue.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$QREF" >> "$LOG" 2>&1; sleep 1
wait_text "Record a verification examination" "workbench detail"
shot "wt-admin-verification-detail-1440"
# record VERIFIED via document examination (evidence selected)
agent-browser find label "Issuing institution" fill "Fixture University (synthetic)" >> "$LOG" 2>&1 || true
agent-browser find label "Scope the credential covers" fill "mathematics-statistics" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-wb.txt 2>&1
EREF=$(grep -E 'CERTIFICATE|degree' /tmp/verify/snap-wb.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
[ -n "$EREF" ] && agent-browser click "$EREF" >> "$LOG" 2>&1
agent-browser find label "Documented reason" fill "Fixture examination: the uploaded document was checked for structural validity — clearly-labelled synthetic evidence in a disposable DB." >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-wb2.txt 2>&1
VREF2=$(grep -E 'Record VERIFIED' /tmp/verify/snap-wb2.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$VREF2" >> "$LOG" 2>&1; sleep 1
wait_text "Verification records (append-only)" "verification record stored"
shot "wt-admin-verification-recorded-1440"

# qualification decision + activation via the Reviewers tab (CI-5B authority)
agent-browser snapshot -i > /tmp/verify/snap-tabs.txt 2>&1
RREF=$(grep -E 'tab.*Reviewers' /tmp/verify/snap-tabs.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$RREF" >> "$LOG" 2>&1; sleep 1
agent-browser snapshot -i > /tmp/verify/snap-rev.txt 2>&1
BREF=$(grep -E 'Begin qualification review|DECIDE|Approve|APPROVED' /tmp/verify/snap-rev.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$BREF" >> "$LOG" 2>&1; sleep 1
log "qualification review started (admin UI)"

# assignment creation via the authenticated API (cookie session)
COOKIE=$(agent-browser cookies 2>>"$LOG" | grep -oE 'bean_session[^ ]*|[A-Za-z0-9._-]{30,}' | tail -1)
curl -s -X POST "$BASE/api/admin/ci5/assignments" -H "content-type: application/json" -b "bean_session=$COOKIE" \
  -d '{"subjectType":"DOMAIN_PACK","subjectKey":"mathematics-statistics","coiCheck":"NONE_DECLARED"}' >> "$LOG" 2>&1 \
  && log "assignment created via API (golden path)"

# ── 6. Reviewer: workspace, availability, rubric submission ──────────────────
log "=== reviewer: workspace ==="
agent-browser cookies clear >> "$LOG" 2>&1
agent-browser open "$BASE/#/auth" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
agent-browser find label "Email" fill "ci6-applicant@bean.test" >> "$LOG" 2>&1 || true
agent-browser find label "Password" fill "bean-ci6-demo" >> "$LOG" 2>&1 || true
agent-browser snapshot -i > /tmp/verify/snap-auth6.txt 2>&1
REF=$(grep -E 'button.*[Ss]ign|lucide-log' /tmp/verify/snap-auth6.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$REF" >> "$LOG" 2>&1; sleep 2
agent-browser open "$BASE/#/reviewer" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
wait_text "Assigned work" "reviewer workspace"
shot "wt-reviewer-workspace-1440"
# start + rubric + submit (A-F all OK → APPROVED)
agent-browser snapshot -i > /tmp/verify/snap-ws.txt 2>&1
SREF=$(grep -E 'Start' /tmp/verify/snap-ws.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$SREF" >> "$LOG" 2>&1; sleep 1
wait_text "Expert review rubric" "rubric disclosure"
for S in A B C D E F; do
  agent-browser find label "Notes for section $S" fill "Fixture rubric notes for section $S — examined in the disposable walkthrough DB." >> "$LOG" 2>&1 || true
  agent-browser find label "Status for section $S" select "OK" >> "$LOG" 2>&1 || true
done
agent-browser find label "Review rationale" fill "Fixture pack review rationale: the inspected pack content was checked against the rubric sections in this disposable walkthrough database." >> "$LOG" 2>&1 || true
shot "wt-reviewer-pack-review-1440"
agent-browser snapshot -i > /tmp/verify/snap-rubric.txt 2>&1
SUBREF=$(grep -E 'Submit|APPROVED' /tmp/verify/snap-rubric.txt | grep -oE 'ref=[a-z0-9-]+' | head -1 | sed 's/ref=//')
agent-browser click "$SUBREF" >> "$LOG" 2>&1; sleep 2
shot "wt-reviewer-completed-1440"

# ── 7. Public expert directory + responsive checks ────────────────────────────
agent-browser open "$BASE/#/experts" >> "$LOG" 2>&1; agent-browser wait --load networkidle >> "$LOG" 2>&1
wait_text "Expert network" "expert directory"
shot "wt-expert-directory-1440"
agent-browser open "$BASE/#/admin/ci5-reviewers" >> "$LOG" 2>&1; sleep 1
agent-browser set viewport 768 1024 >> "$LOG" 2>&1; sleep 1
shot "wt-admin-verification-768"
OVERFLOW768=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth" 2>>"$LOG")
log "overflow@768: $OVERFLOW768"
agent-browser open "$BASE/#/expert-apply" >> "$LOG" 2>&1; sleep 1
agent-browser set viewport 390 844 >> "$LOG" 2>&1; sleep 1
shot "wt-expert-apply-390"
OVERFLOW390=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth" 2>>"$LOG")
log "overflow@390: $OVERFLOW390"
agent-browser set viewport 320 700 >> "$LOG" 2>&1; sleep 1
shot "wt-expert-apply-320"
OVERFLOW320=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth" 2>>"$LOG")
log "overflow@320: $OVERFLOW320"

log "=== CI-6 walkthrough complete — screenshots in $SHOTS ==="
