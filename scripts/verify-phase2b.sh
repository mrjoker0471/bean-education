#!/bin/bash
# Phase 2B end-to-end API verification (single-session: dev server lives only
# inside this command). Results append to /tmp/verify/results.txt
set -u
cd /home/z/my-project
mkdir -p /tmp/verify
R=/tmp/verify/results.txt
: > "$R"
RUN="$(date +%H%M%S)"
SEMAIL="asha-$RUN@example.com"
CEMAIL="riya-$RUN@example.com"
RUN="$(date +%H%M%S)"
SEMAIL="asha-$RUN@example.com"
CEMAIL="riya-$RUN@example.com"

say() { echo "== $1" >> "$R"; }
check() { # check <label> <actual> <expected-substr>
  if [[ "$2" == *"$3"* ]]; then echo "PASS $1" >> "$R"; else echo "FAIL $1 — expected [$3] got: $2" >> "$R"; fi
}

# ── start dev server ──
setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
for i in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then break; fi
  sleep 1
done
curl -s -o /dev/null --max-time 5 http://localhost:3000/ || { echo "SERVER FAILED TO START" >> "$R"; exit 1; }
say "dev server up"

B=http://localhost:3000

# ══ STUDENT JOURNEY ══
say "STUDENT JOURNEY"
reg=$(curl -s -c /tmp/verify/student.jar -X POST $B/api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$SEMAIL\",\"password\":\"learning123\",\"displayName\":\"Asha\"}")
check "student register" "$reg" '"role":"STUDENT"'
check "student register no role-escalation" "$reg" '"onboardedAt":null'

# role self-assignment through registration is refused
reg2=$(curl -s -X POST $B/api/auth/register -H 'content-type: application/json' -d "{\"email\":\"eve-$RUN@example.com\",\"password\":\"learning123\",\"role\":\"ADMIN\"}")
check "role set via register refused (400)" "$reg2" 'Roles cannot be set'

prof=$(curl -s -b /tmp/verify/student.jar -X PATCH $B/api/student/profile -H 'content-type: application/json' -d '{"displayName":"Asha","learningLevel":"UNDERGRAD","interests":["Physics","Python","  ","Physics"],"preferences":{"educationCategory":"COLLEGE","learningStyle":"PRACTICE_FIRST","language":"English","dailyMinutes":45},"onboardingComplete":true}')
check "onboarding PATCH stamps onboardedAt" "$prof" '"onboardedAt":"'
check "educationCategory persisted" "$prof" '"educationCategory":"COLLEGE"'
check "interests deduped" "$prof" '"interests":["Physics","Python"]'

me=$(curl -s -b /tmp/verify/student.jar $B/api/auth/me)
check "me returns role + onboardedAt" "$me" '"role":"STUDENT"'

dash=$(curl -s -b /tmp/verify/student.jar $B/api/student/dashboard)
check "dashboard honest zeros (attempts 0)" "$dash" '"count":0'
check "dashboard accuracy null" "$dash" '"accuracy":null'
check "dashboard recommends first goal" "$dash" '"key":"first-goal"'
check "dashboard has continueLearning" "$dash" '"recentDocuments":[]'

goal=$(curl -s -b /tmp/verify/student.jar -X POST $B/api/student/goals -H 'content-type: application/json' -d '{"title":"Complete a Python course","targetDate":"2027-06-30"}')
check "goal created (general, no exam)" "$goal" '"title":"Complete a Python course"'
dash2=$(curl -s -b /tmp/verify/student.jar $B/api/student/dashboard)
check "dashboard shows active goal" "$dash2" 'Complete a Python course'

# student refused privileged PYQ actions (403)
imp=$(curl -s -b /tmp/verify/student.jar -X POST $B/api/pyq/import -H 'content-type: application/json' -d '{"paperTitle":"X paper","fileName":"f.json","examSlug":"qa-demo-exam","items":[{"text":"Which demo option is keyed here?","options":["A","B"],"correctIndex":0}]}')
check "student import refused (curator-only)" "$imp" 'restricted to authorised curators'
bat=$(curl -s -b /tmp/verify/student.jar $B/api/pyq/batches)
check "student batches refused 403" "$bat" 'curator'
qs=$(curl -s -b /tmp/verify/student.jar $B/api/pyq/questions)
check "student questions refused 403" "$qs" 'curator'

# ══ CURATOR JOURNEY ══
say "CURATOR JOURNEY"
regc=$(curl -s -c /tmp/verify/curator.jar -X POST $B/api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$CEMAIL\",\"password\":\"curation123\"}")
check "curator account registers as STUDENT" "$regc" '"role":"STUDENT"'

grant=$(bun scripts/grant-role.ts --email=$CEMAIL --role=PYQ_CURATOR --yes 2>&1)
check "grant-role CLI applies" "$grant" "now holds PYQ_CURATOR"
deny=$(bun scripts/grant-role.ts --email=ghost@x.io --role=ADMIN 2>&1)
check "grant-role refuses unknown account" "$deny" "No account found"

cat > /tmp/verify/pyq-batch.json <<JSON
{
  "paperTitle": "QA Demo Course Paper $RUN",
  "fileName": "qa-demo-$RUN.json",
  "examSlug": "qa-demo-exam",
  "examLabel": "QA Demo Course",
  "stageLabel": "Core paper",
  "subjectLabel": "Demo subject",
  "year": 2025,
  "session": "2025",
  "sourceCitation": "QA fixture — not a real paper",
  "items": [
    { "text": "Which Article of the Constitution abolishes untouchability? ($RUN)", "options": ["Article 15", "Article 17", "Article 19", "Article 21"], "correctIndex": 1, "explanation": "Article 17.", "year": 2025, "sourceRef": "QA fixture Q.1" },
    { "text": "Which demo topic covers Sangam literature ports? ($RUN)", "options": ["Demo topic 1", "None", "Other", "All"], "correctIndex": 0, "year": 2025 },
    { "text": "bad row", "options": ["only-one"], "correctIndex": 0 }
  ]
}
JSON
imp1=$(curl -s -b /tmp/verify/curator.jar -X POST $B/api/pyq/import -H 'content-type: application/json' -d @/tmp/verify/pyq-batch.json)
check "curator import created 2" "$imp1" '"createdCount":2'
check "curator import failed 1 (row audit)" "$imp1" '"failedCount":1'
imp2=$(curl -s -b /tmp/verify/curator.jar -X POST $B/api/pyq/import -H 'content-type: application/json' -d @/tmp/verify/pyq-batch.json)
check "re-import counts duplicates" "$imp2" '"duplicateCount":2'

bat2=$(curl -s -b /tmp/verify/curator.jar $B/api/pyq/batches)
check "batches list shows import" "$bat2" "QA Demo Course Paper $RUN"

q1=$(curl -s -b /tmp/verify/curator.jar "$B/api/pyq/questions?status=UNVERIFIED&limit=10")
qid1=$(echo "$q1" | python3 -c "import sys,json; d=json.load(sys.stdin); print([q['id'] for q in d['questions'] if 'untouchability' in q['text']][0])")
qid2=$(echo "$q1" | python3 -c "import sys,json; d=json.load(sys.stdin); print([q['id'] for q in d['questions'] if 'Sangam' in q['text']][0])")
check "questions list shows UNVERIFIED provenance" "$q1" '"sourcePaper":"QA Demo Course Paper'

rev1=$(curl -s -b /tmp/verify/curator.jar -X POST $B/api/pyq/review -H 'content-type: application/json' -d "{\"questionId\":\"$qid1\",\"action\":\"APPROVE\",\"note\":\"Checked against the official answer key fixture, Q.1 — Article 17 is keyed.\"}")
check "curator approves -> PYQ_VERIFIED" "$rev1" '"sourceType":"PYQ_VERIFIED"'
rev2=$(curl -s -b /tmp/verify/curator.jar -X POST $B/api/pyq/review -H 'content-type: application/json' -d "{\"questionId\":\"$qid2\",\"action\":\"REJECT\",\"note\":\"Answer key mismatch in the fixture.\"}")
check "curator rejects -> REJECTED" "$rev2" '"verificationStatus":"REJECTED"'

rev3=$(curl -s -b /tmp/verify/curator.jar -X POST $B/api/pyq/review -H 'content-type: application/json' -d "{\"questionId\":\"$qid1\",\"action\":\"REJECT\"}")
check "verified PYQ cannot be rejected (downgrade guard)" "$rev3" 'cannot be rejected here'
rev4=$(curl -s -b /tmp/verify/curator.jar -X POST $B/api/pyq/review -H 'content-type: application/json' -d "{\"questionId\":\"$qid2\",\"action\":\"APPROVE\",\"note\":\"too short\"}")
check "short justification refused 400" "$rev4" 'justification'

qv=$(curl -s -b /tmp/verify/curator.jar "$B/api/pyq/questions?status=VERIFIED")
check "verified listing records reviewer" "$qv" '"role":"PYQ_CURATOR"'
check "verified listing records justification" "$qv" 'answer key fixture'

# ══ GUEST REGRESSION ══
say "GUEST REGRESSION"
cat_resp=$(curl -s $B/api/catalog)
check "guest catalog works" "$cat_resp" '"categories"'
exams_resp=$(curl -s "$B/api/exams?search=demo")
check "guest exams list shows QA demo" "$exams_resp" 'qa-demo-exam'
guestbat=$(curl -s "$B/api/pyq/batches?guestId=0123456789abcdef")
check "guest PYQ batches refused (curator-only now)" "$guestbat" 'Sign in required'
guestimp=$(curl -s -X POST $B/api/pyq/import -H 'content-type: application/json' -d '{"paperTitle":"Guest try","fileName":"g.json","examSlug":"qa-demo-exam","guestId":"0123456789abcdef","items":[{"text":"Guest import attempt question?","options":["A","B"],"correctIndex":0}]}')
check "guest import refused (no guest path)" "$guestimp" 'Sign in required'
dashguest=$(curl -s $B/api/student/dashboard)
check "guest dashboard 401" "$dashguest" 'Sign in required'

# student data isolation: curator must not see asha's goals
goaliso=$(curl -s -b /tmp/verify/curator.jar $B/api/student/goals)
check "isolation: curator sees zero asha goals" "$goaliso" '"goals":[]'

say "DONE"
echo "results written to $R"
