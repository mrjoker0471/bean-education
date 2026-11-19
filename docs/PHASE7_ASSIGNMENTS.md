# PHASE 7 — INSTITUTION ASSIGNMENTS

Status: delivered on `feat/bean-institution-career-phase-7`. Companion to `docs/PHASE7_INSTITUTIONS.md`.

## 1. Models

`OrganizationAssignment` — organization + group scoped, authored by a membership, `DRAFT | PUBLISHED | CLOSED | ARCHIVED`, instructions (bounded plain text), subject label, `submissionType` (`TEXT | EXTERNAL_LINK | TEXT_AND_LINK`), `dueAt`, `maxScore`, `publishedAt`.

`AssignmentSubmission` — **unique pair** `(assignmentId, studentId)`; `DRAFT | SUBMITTED | RETURNED | GRADED`; response text (≤ 8000 chars) and/or HTTPS external link; grading fields (`gradedByMembershipId`, `gradeValue`, `teacherFeedback`, `gradedAt`).

## 2. Resubmission policy (documented behavior)

One live record per student per assignment. Resubmission **updates the same row** while the assignment is `PUBLISHED` and before `dueAt` (route-tested: two submissions → one row, second response wins). A `RETURNED` submission can be reworked by its author (student PATCH path) which sets it back to `SUBMITTED` for the instructor. `GRADED` submissions are final unless returned. Nothing is ever deleted — history lives in the row's timestamps and the organization audit trail (`SUBMISSION_GRADED` / `SUBMISSION_RETURNED`).

## 3. Permissions (all server-enforced; route-tested)

| Action | Who |
|---|---|
| Create / publish / close / archive assignments | OWNER/ADMIN/INSTRUCTOR of the organization (`requireOrgInstructor`), staff manage any group; publication audited |
| See assignments | Staff: all group assignments in the org. Learners: only `PUBLISHED` assignments of groups they are **actively** enrolled in |
| Submit / resubmit | Actively-enrolled learners only (enrollment re-checked per request); deadline enforced; `DRAFT/CLOSED/ARCHIVED` assignments reject submissions |
| Read submissions | Author sees only their own (`mySubmission`); staff see the group's submissions for grading. **A learner asking for another student's submission gets 404** — never leaked |
| Grade / return | Group instructor (must hold an ACTIVE enrollment in the owning group) or org OWNER/ADMIN; archived assignments refuse grading |
| Read grades & feedback | The author student and permitted institutional staff only — grades are never public and never appear in any other student's DTO |

## 4. Content rules

- Text submissions: bounded (8000) plain text, control characters rejected (shared Zod helper).
- External links: valid **HTTPS** URL only (`javascript:` and other schemes rejected — route-tested). No arbitrary public upload paths exist; document attachments are out of scope for Phase 7 (they would use the existing private storage/ownership model, never `public/`).
- Grade values are free-form labels (≤ 40 chars) — institutions define their own scales; BEAN never invents numeric aggregates from them.

## 5. Rate limits

Assignments: 20/day/organization. Submission edits: 30/day/student (24h rolling window, 429 with an honest message).

## 6. Privacy guarantees

- Grades and feedback travel **only** in two authorized DTOs: the author's own `mySubmission` and the staff submissions list (scoped to the owning group).
- Other students' submissions are unreachable by id (ownership verified before any read).
- Assignments for groups a student left remain visible in their history only through the org's records; new submissions are refused (`enrollmentState` re-checked per request).
