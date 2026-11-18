# Phase 2B — PYQ Curation Workspace (curator handbook)

The studio lives at **`#/pyq-studio`** and is visible only to `PYQ_CURATOR` / `ADMIN` accounts (the server enforces the same rule on every endpoint — hiding the nav item is convenience, not security).

## Why curation exists

Previous-year questions are valuable only if their provenance is trustworthy. The pipeline is deliberately two-stage:

1. **Import** — a curator uploads a structured JSON paper → every row lands `PYQ_UNVERIFIED` and is INVISIBLE to students (test selection excludes unverified/rejected rows).
2. **Review** — a curator verifies each row against its source → `PYQ_VERIFIED`, with a mandatory written justification. Rejection requires explicit confirmation and excludes the row from practice.

AI-generated (ORIGINAL) rows never appear in this workspace and can never be relabelled as historical questions. Years and source references are never invented — the UI prefers leaving a field empty over guessing.

## Import tab

1. **File**: JSON with `items` (2–500 rows). Row shape:

```json
{
  "text": "Which Article of the Constitution abolishes untouchability?",
  "options": ["Article 15", "Article 17", "Article 19", "Article 21"],
  "correctIndex": 1,
  "explanation": "Article 17 abolishes untouchability.",
  "difficulty": "EASY",
  "year": 2019,
  "sourceRef": "Official preliminary answer key 2019, Q.101",
  "language": "English",
  "stageId": "…optional catalogue stage…",
  "subjectId": "…optional, must belong to the stage…",
  "topicId": "…optional, must belong to the subject…"
}
```

2. **Metadata**: paper title, **catalogue exam (required)**, year, session, stage/subject labels, source citation. Metadata pre-fills from the file when present; the form is authoritative.
3. **Pre-flight**: the client mirrors the server's row rules and shows row-scoped failures before anything is sent; the server re-validates everything and stays authoritative.
4. **Result**: created / duplicate / failed counts + per-row errors. Duplicates are detected by content hash (normalized text + options + answer key) and counted, never re-inserted. The batch audit row exists even if every row fails.

### Rights & honesty rules (binding)

- Import only papers you have the rights to use. **Do not scrape or import copyrighted question papers without appropriate rights.**
- Do not claim historical coverage that does not exist: an empty bank shows an empty state; a batch's citation should point at a real source you actually checked.
- `sourceRef` should be precise enough for a second person to find the same question (booklet, page, question number).

## Review queue

- Filters: status chips (All / Unverified / Verified / Rejected with exact live counts), exam, year, batch, text search.
- Every card renders the full provenance: question text, options with the keyed answer highlighted, explanation, source paper, year, session (from the batch), source reference, import batch (file, date, importer), reviewer identity + role + review note.
- **Approve** requires a justification of 10–400 characters — say WHAT you checked the row against ("official key, booklet page, archive id"). The justification is stored on the question AND the audit event, and is rendered to future reviewers.
- **Reject** requires an explicit confirmation; a reason is optional but strongly recommended (stored in the audit trail). Rejected rows never enter practice tests.
- **Downgrades are deliberately impossible here**: a verified row cannot be rejected from the queue (409). Unverification is a separate, deliberate curation action — by design not one click.

## History tab

The last 50 import batches with counts and expandable row errors — the shared provenance record for the whole bank (each batch records who imported it).

## Known architectural limitation (kept honest)

**The current PYQ database requires a catalogue `examSlug`** — `Question.examId` is a hard foreign key. The catalogue today models government-exam-style entries, so:

- College/university **semester papers** and generic **course assessments** cannot be represented as PYQ rows yet. The studio states this in the UI instead of forcing every paper into a government-exam category.
- Future work (separate milestone): extend the catalogue with education-category-aware containers (e.g. `Course`/`Paper` entities) OR relax the FK to a provenance-only label with a review gate. Both need migration design + test-selection changes; neither is faked in this phase.
- Web-based historical question research is explicitly NOT part of this milestone — that is a future Riishe Deep Research phase.

## API contracts used by the studio

| Endpoint | Role | Contract |
|---|---|---|
| `POST /api/pyq/import` | curator/admin | Body: paper metadata + `items[]`; 401 guest / 403 student; returns `{batchId, totalRows, createdCount, duplicateCount, failedCount, errors[]}` |
| `GET /api/pyq/batches` | curator/admin | Latest 50 batches with counts + first 10 row errors each |
| `GET /api/pyq/questions` | curator/admin | Filters `status, exam, year, batch, q, limit≤100, offset`; returns provenance-complete cards + exact per-status counts |
| `POST /api/pyq/review` | curator/admin | `{questionId, APPROVE\|REJECT, note}`; approve note 10..400 required; reject on verified → 409 |
| `scripts/pyq-import.ts` | operator CLI | Same import endpoint with a curator session cookie (`PYQ_COOKIE`); `--dry-run` validates without auth |
| `scripts/grant-role.ts` | operator CLI | The ONLY way to change roles (see PHASE2B_SECURITY.md) |
