# CI-5 REVIEWER UX — Governance Workspaces

> Unit: CI-5G · Status: implemented; browser-verified with real screenshots in
> CI-5H (`docs/screenshots/ci5-governance/`). The UI uses real backend APIs
> only — no fake reviewer accounts, fabricated qualifications, mock metrics or
> mock approval results exist anywhere in these surfaces.

## 1. Surfaces

| Route | Who | Purpose |
|---|---|---|
| `#/admin/ci5-reviewers` | BEAN administrators | CI-5 governance workspace |
| `#/reviewer` | qualified reviewers | expert reviewer workspace |

Both are additive hash routes (all existing routes unchanged), follow the BEAN
design system (obsidian black, champagne/metallic gold accents, warm ivory
text, restrained glassmorphism via the existing `border-gold/30 bg-gold/10`
elevated surfaces), and are responsive from 320 px up (44 px minimum touch
targets, `min-w-0` truncation on all long identifiers, natural text wrapping,
no horizontal overflow).

## 2. Admin workspace (`#/admin/ci5-reviewers`)

Five tabs, all reading live data:

- **Reviewers** — the registry: reviewerCode, category, verification status,
  qualification, approved scopes (domains / language+task lists), expiry.
  Lifecycle actions map 1:1 to the server transition table
  (`BEGIN_QUALIFICATION_REVIEW`, `DECIDE` (approve with the fixture-scope
  payload surfaced as such), `ACTIVATE`, `SUSPEND` with recorded reason);
  illegal transitions surface the server's honest refusal as a toast, never a
  fake success.
- **Assignments** — the queue: subject, version, risk class, reviewer code,
  status.
- **Language** — the durable capability grid (11 languages × 5 tasks) resolved
  from the persisted governance store, with basis (structural / default /
  measurement-only / human-approved) and the structural UNSUPPORTED
  transcription rows visible.
- **Benchmarks** — the dataset registry: task kind, split, version, case
  counts, expert-label counts.
- **Report audits** — the audit register: verdicts, findings counts,
  preserved-auditor flag.

The workspace performs **no client-side mutations beyond the server actions**;
every status transition is attributable to the signed-in administrator through
the server-resolved actor.

## 3. Expert reviewer workspace (`#/reviewer`)

- **Profile card**: reviewerCode, status badge, category, qualification,
  expiry, and the exact approved scope (domains; languages with their task
  lists). No other reviewer's information is exposed.
- **Assigned work** — only the reviewer's own assignments:
  - `DOMAIN_PACK`: start/recuse + the **A–F rubric form** (per-section
    OK/ISSUE/NOT_ASSESSED + notes, rationale field) with the honest hint that
    APPROVED requires every section OK and the decision lands in the
    append-only pack review ledger bound to the exact checksum. The submit
    button states the decision the rubric will produce.
  - `LANGUAGE_CAPABILITY`: the **13-facet bilingual checklist** (compact
    responsive grid) with the measurement-binding note; APPROVED requires
    every facet OK.
  - `CLASSROOM_REPORT`: load the **masked evidence view** (restricted to
    assigned reviewers server-side), audit verdict buttons, unobservable
    dimensions recorded automatically.
  - Recusal with a recorded reason is always available for open work.
- **Review history**: the reviewer's own append-only lifecycle events.

## 4. Governance guarantees surfaced in the UI

- Append-only decisions: the UI never offers an edit/delete of any decision.
- Every status transition is a real, server-authorised event — the UI renders
  the server's refusal messages verbatim (e.g. self-review refusal, scope
  mismatch, stale checksum) instead of inventing success states.
- No fabricated data: empty states are honest ("No reviewer profiles yet",
  "No assignments"); loading states are real; the admin "Approve" action in
  the workspace explicitly labels its default payload as a fixture scope to be
  replaced with real evidence before real use.

## 5. Accessibility

- Semantic structure with headings, `role="tablist"`/`role="tab"` with
  `aria-selected` for the workspace sections, labelled inputs
  (`aria-label` on every notes/select control), `details/summary` disclosure
  patterns for the review forms (keyboard-operable without JS widgets).
- 44 px minimum interactive height on all buttons/controls; focus states via
  the existing BEAN button/input styles.
- Long identifiers truncate (`min-w-0 truncate`) instead of overflowing;
  small-font metadata stays ≥11 px with sufficient contrast.

## 6. Tested

Route-level tests cover the full data flow behind these surfaces
(`tests/unit/ci5-report-audit.test.ts`, plus the CI-5B/5C/5E/5F suites that
exercise every API the workspaces call). Source guards assert the UI calls the
real APIs and contains no mock-data identifiers. Browser walkthrough evidence
with real screenshots at 1440/768/390/320 px is recorded in CI-5H
(`CI5-RESULTS.md` + `docs/screenshots/ci5-governance/`).
