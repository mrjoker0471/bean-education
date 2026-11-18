# Phase 2A — PYQ (Previous-Year Question) Ingestion

Status: **foundation implemented, bank empty.** The bank currently contains
zero PYQ records; all surfaces report this honestly until a real,
permission-cleared import happens. Nothing in this pipeline fakes data.

## No-scraping policy

Bean Learn does **not** scrape question papers from the web. The only supported
ingestion path is a **structured JSON file you already have the right to use**
(official answer-key exports, question banks you own or that are openly
licensed, transcriptions you made yourself). Every import records its source
citation and file name, so provenance is always auditable. If you cannot state
where a question came from and why you may use it, do not import it.

## Pipeline overview

```
structured JSON file
        │
        ▼
POST /api/pyq/import          → per-row validation → content hash → duplicate
        │                       detection → Question rows (PYQ_UNVERIFIED)
        │                       + PyqImportBatch audit row
        ▼
GET  /api/pyq/batches         → audit trail (latest 50 batches, honest zero-data)
        │
        ▼
POST /api/pyq/review          → APPROVE (written justification required)
        │                       or REJECT (REJECTED rows are excluded from tests)
        ▼
PYQ_VERIFIED rows serve like any other bank question
```

## Import JSON format

Batch-level fields:

| Field            | Type   | Required | Rules                                  | Stored on batch as    |
| ---------------- | ------ | -------- | -------------------------------------- | --------------------- |
| `paperTitle`     | string | yes      | 3..200 chars                           | `paperTitle`          |
| `fileName`       | string | yes      | 1..200 chars                           | `fileName`            |
| `examSlug`       | string | yes      | must exist in the exam catalogue       | `examSlug` (resolved) |
| `examLabel`      | string | no       | <= 200 chars, free text                | `examLabel`           |
| `stageLabel`     | string | no       | <= 200 chars                           | `stageLabel`          |
| `subjectLabel`   | string | no       | <= 200 chars                           | `subjectLabel`        |
| `year`           | number | no       | integer 1990..2035                     | `year`                |
| `session`        | string | no       | <= 100 chars (e.g. `"Session 1"`)      | `session`             |
| `sourceCitation` | string | no       | <= 500 chars                           | `sourceCitation`      |
| `guestId`        | string | no       | 8..64 chars — used when not signed in  | `importedBy`          |
| `items`          | array  | yes      | 1..500 rows                            | `totalRows`           |

`examSlug` is **required**: `Question.examId` is a hard foreign key, so every
PYQ row must attach to a real catalogue exam. Unknown slugs get an immediate
400 — nothing is written. `examLabel` / `paperTitle` remain free-text
provenance metadata (and feed the canonical-slug fallback).

Item-level fields:

| Field          | Type   | Required | Rules                                                    | Stored on Question as        |
| -------------- | ------ | -------- | -------------------------------------------------------- | ---------------------------- |
| `text`         | string | yes      | trimmed 10..2000 chars                                   | `text`                       |
| `options`      | array  | yes      | 2..6 non-empty strings, each <= 500 chars                | `optionsJson` (JSON array)   |
| `correctIndex` | number | yes      | integer in `[0, options.length)` (canonical answer-index rule) | `correctIndex`         |
| `explanation`  | string | no       | <= 4000 chars; empty string stored when absent           | `explanation`                |
| `difficulty`   | string | no       | `EASY` \| `MEDIUM` \| `HARD` (default `MEDIUM`)          | `difficulty`                 |
| `year`         | number | no       | integer 1990..2035; overrides the batch year             | `year`                       |
| `sourceRef`    | string | no       | <= 500 chars — page / booklet / archive reference        | `sourceRef`                  |
| `stageId`      | string | no       | must exist and belong to the exam, else row fails        | `stageId`                    |
| `subjectId`    | string | no       | must exist, belong to the exam (and stage)               | `subjectId`                  |
| `topicId`      | string | no       | must exist, belong to the exam (and subject/stage)       | `topicId`                    |
| `language`     | string | no       | <= 60 chars (default `English`)                          | `language`                   |

Wrong catalog ids (`stageId` / `subjectId` / `topicId` that do not exist or
belong to another exam) fail **that row honestly** with a per-row error —
rows are never silently dropped or re-pointed.

### Complete example (2 items)

```json
{
  "paperTitle": "TNPSC Group 2 Prelims 2019 — General Studies",
  "fileName": "tnpsc-group2-2019-gs.json",
  "examSlug": "tnpsc-group-2",
  "examLabel": "TNPSC Group 2",
  "stageLabel": "Prelims",
  "subjectLabel": "General Studies",
  "year": 2019,
  "session": "2019",
  "sourceCitation": "TNPSC Group 2A 2019 official preliminary key, Q.101-102",
  "items": [
    {
      "text": "Which Article of the Constitution of India abolishes untouchability?",
      "options": ["Article 15", "Article 17", "Article 19", "Article 21"],
      "correctIndex": 1,
      "explanation": "Article 17 abolishes untouchability; its practice in any form is a punishable offence.",
      "difficulty": "EASY",
      "year": 2019,
      "sourceRef": "Official preliminary answer key 2019, Q.101"
    },
    {
      "text": "Match the following pairs about Sangam literature ports and modern locations.",
      "options": ["A-2 B-1", "A-1 B-2", "A-3 B-4", "A-4 B-3"],
      "correctIndex": 0,
      "explanation": "Musiri corresponded to the west-coast trade documented in Sangam poems.",
      "difficulty": "MEDIUM",
      "sourceRef": "Booklet 2, Section B, Q.44"
    }
  ]
}
```

### API contract

`POST /api/pyq/import`
- Auth: signed-in student preferred (session cookie); otherwise `guestId`
  (8..64 chars) in the body — guests **may** import; provenance records who.
- 400: malformed body, unknown `examSlug`, `items` out of 1..500 range.
- 401: neither a session nor a `guestId`.
- Response 200:

```json
{
  "batchId": "cuid…",
  "totalRows": 2,
  "createdCount": 2,
  "duplicateCount": 0,
  "failedCount": 0,
  "errors": []
}
```

`errors` carries at most the **first 20** `{ row, error }` entries (row is the
0-based index into `items`); the **full** per-row audit lives on the batch row
(`errorsJson`).

`GET /api/pyq/batches?guestId=…`
- Auth: student session or `guestId` query param, else 401.
- Response 200: `{ batches: [...latest 50...], count, note? }` — each batch
  includes counts plus the first 10 per-row errors and `errorCount`.
- When nothing has ever been imported: `{ batches: [], count: 0, note: "No PYQ imports recorded yet — the bank currently contains zero PYQ records." }`.
  Surfaces must render this verbatim, never invent data.

### Provenance rules (enforced in code, not by convention)

- The import endpoint **only ever creates** `sourceType: "PYQ_UNVERIFIED"`
  rows with `verificationStatus: "UNVERIFIED"`.
- It **never** creates `PYQ_VERIFIED` rows and **never** relabels `ORIGINAL`
  rows. Verification happens exclusively through the review endpoint.
- Every created row carries `sourcePaper` (paper title), `year`,
  `sourceRef`, `importedBatchId` and `pyqHash` — the full audit trail needed
  to answer "where did this question come from?".

### Duplicate detection

Each row is hashed with `computePyqHash` (sha256 over a deterministic JSON
payload of the **normalized** text, normalized options and `correctIndex`;
normalization trims, collapses whitespace, lowercases and strips punctuation /
smart quotes — Unicode-aware). If any existing question already carries the
same `pyqHash`, the row is counted in `duplicateCount` and **not** inserted.
The import response counts duplicates; it does not list them (no hash prefixes
leak into user-facing errors). Re-importing the same file is therefore safe:
`createdCount: 0, duplicateCount: N`.

## Review workflow

`POST /api/pyq/review` — `{ questionId, action: "APPROVE" | "REJECT", note? }`

- **Signed-in students only** (401 for guests): verification is a reviewed
  workflow with an accountable reviewer.
- **APPROVE** requires a written justification of **10..400 chars** — a
  verification without a reason is not a verification. Sets
  `sourceType: "PYQ_VERIFIED"`, `verificationStatus: "VERIFIED"`, and records
  `reviewedBy` (student id), `reviewedAt`, `reviewNote`. Allowed on
  `PYQ_UNVERIFIED` (first verification) and `PYQ_VERIFIED` (re-review).
- **REJECT** is only allowed from `PYQ_UNVERIFIED` (409 on `PYQ_VERIFIED` —
  unverifying a reviewed record is a deliberate curation action, not a
  one-click downgrade). Sets `verificationStatus: "REJECTED"` plus the same
  reviewer fields; `note` is optional.
- **ORIGINAL / AI-generated rows are never touched** (409).
- Response: `{ id, sourceType, verificationStatus }`.

**REJECTED rows are excluded from test selection.** `/api/tests/start` filters
`verificationStatus: { not: 'REJECTED' }` on every availability count and
question selection (including revision tests). Unverified PYQ rows may still
serve — they are simply not yet reviewed.

## Audit trail

Every import creates a `PyqImportBatch` row **before** processing items and
updates it with final counts afterwards — so even a fully failed import
leaves an honest record:

| Field            | Meaning                                                    |
| ---------------- | ---------------------------------------------------------- |
| `paperTitle`     | paper identity as claimed by the importer                   |
| `examSlug`       | resolved catalogue exam (rows attach to it)                 |
| `examLabel` etc. | free-text provenance labels                                 |
| `fileName`       | the structured file that was imported                       |
| `importedBy`     | student id (authenticated) or guestId                       |
| `totalRows`      | rows submitted                                              |
| `createdCount`   | rows inserted (always `PYQ_UNVERIFIED`)                     |
| `duplicateCount` | rows skipped as content-duplicates (`pyqHash` match)        |
| `failedCount`    | rows that failed validation / FK checks / db write          |
| `errorsJson`     | full per-row audit `[{row, error}]`                         |

## CLI helper

```bash
bun scripts/pyq-import.ts /tmp/pyq-sample.json --dry-run   # validate only, no POST
bun scripts/pyq-import.ts /tmp/pyq-sample.json             # real import (guest provenance)
bun scripts/pyq-import.ts /tmp/pyq-sample.json --guest-id=ramesh-1990
```

The script is standalone (plain `fetch`, no src imports) and includes an
example payload in its header comment. Its dry-run check is a pre-flight
sanity mirror; server-side validation, hashing, duplicate detection and
catalog-id checks remain authoritative on a real import.

## Honest current state

**The bank currently contains zero PYQ records; surfaces report this honestly
until a real, permission-cleared import happens.** The endpoints above are the
only ingestion path, the review endpoint is the only path to
`PYQ_VERIFIED`, and `/api/tests/start` never serves `REJECTED` rows.
