# CI-5 CLASSROOM PILOT — Privacy-Masked Report-Audit

> Unit: CI-5G · Status: pilot workflow implemented and tested
> (`tests/unit/ci5-report-audit.test.ts`). The pilot operates on the EXISTING
> classroom evaluation reports (CI-3/CI-4 pipeline output) with a
> clearly-labelled synthetic fixture for exercises. **No real report has been
> audited by a real reviewer yet.**

## 1. What the pilot does

1. A completed class generates the existing evaluation (unchanged CI-3/CI-4
   pipeline — the report version is preserved verbatim).
2. The system builds a **masked evidence view** at read time: student names,
   emails, private messages, individual academic histories, unrelated teacher
   profile details and identity fields are replaced with an explicit
   "[masked — not necessary for the review]" marker; class metadata is
   separated from actual teaching evidence.
3. An authorised reviewer receives **only that masked view** — authorisation
   is the CI-5C assignment (`CLASSROOM_REPORT` subject type) plus the
   restricted-view route requiring the reviewer to hold the assignment. No new
   route around student/teacher ownership checks exists; teacher disputes
   continue through the existing Trust workflow.
4. The reviewer checks the report's claims against the actual evidence and
   records **supported / unsupported / ambiguous** findings.
5. The Evidence Auditor's findings remain preserved (audits never edit the
   report; `status` stays CURRENT).
6. Corrections are recorded as **new audit rows** bound to the exact report
   checksum — a changed report refuses (409) and the re-inspection produces a
   new row.
7. The teacher can dispute inaccurate findings through the existing
   `ClassroomEvaluationDispute` flow — untouched by this milestone.

## 2. Honest unobservability

BEAN's classroom observation is structured-only (no audio/video transcripts —
CI-4 §9.2 gate intact). The masked view therefore marks these dimensions
**UNOBSERVABLE** and reviewers are never asked to guess:

- every spoken explanation
- actual question handling
- every student interaction
- individual student comprehension
- teacher tone or pronunciation
- real-time classroom discussion quality

Audit rows record these markers verbatim; a reviewer who cannot observe a
dimension marks it rather than inferring it. Attendance is never used to infer
individual learning outcomes.

## 3. Privacy guarantees

- Masking is applied server-side at read time — masked data never leaves the
  server for the reviewer surface (proven in tests: the masked view contains
  neither the fixture student name nor email).
- Reviewers do not see other reviewers' information.
- The pilot fixture is **clearly labelled synthetic** ("[CI-5 PILOT FIXTURE]"
  title, REJECTED teacher profile that can never publish, placeholder personal
  data that the masking layer removes) — no hidden recording, no automatic
  transcription, no audio/video surveillance anywhere in the pilot.
- The report-audit write path never touches the dispute tables.

## 4. Verified verdict rules

- `SUPPORTED` / `PARTIALLY_SUPPORTED` / `NOT_SUPPORTED` / `CORRECTIONS_RECORDED`.
- `NOT_SUPPORTED` / `CORRECTIONS_RECORDED` require concrete unsupported
  findings (refusal without naming claims).
- Every row records: report id + version + sha256 checksum of the audited
  payload, server-resolved reviewer (studentId + reviewerCode), assignment
  linkage, findings JSON, unobservable markers, masking note, rationale.
- A suspended/expired reviewer cannot audit (403).

## 5. Tested behaviour

Masking (student data absent, marker present, metadata/evidence separation,
unobservable dimensions); checksum binding (stale refuse, corrections as new
rows); verdict/finding consistency; end-to-end assignment → masked view →
audit → COMPLETED with outcomeRef; ownership enforcement on the view and the
submit; audit register with findings counts and preserved-auditor flags;
Evidence Auditor findings untouched after audits; UI source guards (real APIs
only, no mock data, no dispute bypass).
