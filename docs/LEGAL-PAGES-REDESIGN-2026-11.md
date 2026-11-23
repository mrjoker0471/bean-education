# BEAN Education — Legal Pages Document Redesign (2026-11-23)

Milestone: `bean-legal-pages-redesign` · Branch: `feat/bean-legal-pages-redesign` ·
PR gate: https://github.com/mrjoker0471/bean-education/compare/main...feat/bean-legal-pages-redesign

## 1. Mandate

Give Terms & Conditions and Privacy Policy a professional legal-document
treatment on the BEAN Education design system — version/last-updated/
effective-date information, table of contents and section navigation on
mobile and desktop, clearly classified sections, Notice callouts for
statements that must not be missed — while preserving every word of legal
content and every honesty rule (no invented entity, contacts, dates,
certifications or compliance claims; draft/legal-review notices stay visible;
the documents are never presented as legally approved).

## 2. What was built

- **Document header chips**: Version, Last updated and Effective date, all
  sourced from `GET /api/legal/config`. Unset values render honest pending
  notices — "To be recorded — pending legal review" and "Not yet in effect —
  pending legal review". The draft badge (owner's Indian legal review pending)
  remains prominent.
- **Backend dates support** (`src/lib/legal-config.ts`): four owner-
  configurable env vars (`BEAN_{TERMS,PRIVACY}_{LAST_UPDATED,EFFECTIVE_DATE}`),
  accepted only as strict `YYYY-MM-DD` calendar dates. `lastUpdated` falls
  back to the date stamped in the version identifier (the version's own stamp,
  never fabricated). `effectiveDate` is never derived — until configured, the
  pages say the document is not yet in effect. `.env.example` documents all
  four with their honesty rules.
- **Section classification**: small gold badges above headings —
  `Your rights`, `Responsibilities`, `Privacy practice`, `Important notice`,
  `Operator & grievance` — so long documents scan clearly. Purely visual.
- **Notice callouts** (visual wrapper only, text verbatim): Terms — age
  requirement, AI-generated content, governing-law review status; Privacy —
  children/guardian current status.
- **Navigation**: sticky glass TOC with scroll-spy on desktop; collapsible
  "On this page · 22 sections" details panel on mobile; back-to-top control
  after 700px of scroll.
- **Grievance block**: classified `Operator & grievance`, Grievance Officer
  rows emphasised, config-aware "to be provided" honesty unchanged.

## 3. Privacy & data-handling verification (against the actual code)

| Statement on the page | Evidence |
|---|---|
| Passwords: salted, irreversibly hashed | `src/lib/auth.ts` — scrypt N=16384, r=8, p=1, 16-byte random salt, 64-byte key, stored `scrypt$N$r$p$salt$hash` |
| Sessions: 30 days, sliding renewal | `SESSION_TTL_MS = 30 * 24 * 3600_000` (`src/lib/auth.ts`) |
| httpOnly cookie; DB stores only the token hash | `httpOnly: true` cookie options; `createHash('sha256').update(token)` before storage |
| Google scopes limited to `openid email profile`; no OAuth token storage | `SCOPES = 'openid email profile'` (`src/lib/oauth-google.ts`); PKCE/state/nonce verified in the brand-redesign audit |
| No email provider, analytics, ads or tracking SDKs | dependency + source scan: zero matches (only false-positive substrings like `maxUses`) |
| Guest mode: random, device-local identifier | `uuidv4()` persisted in `localStorage` only (`src/lib/store.ts`) |
| Export: machine-readable JSON download | `Content-Disposition: attachment` JSON response (`api/auth/account/export`) |
| Deletion: typed confirmation + password re-auth | `api/auth/account/delete` requires typed `DELETE` **and** password re-auth for password accounts |
| One subject → one Google account; audience choice never grants roles | verified in the brand-redesign audit (oauth routes + tests) |
| Complaint/safeguarding confidentiality, append-only history | verified in the brand-redesign audit (Phase 6 backend) |

Terms/Privacy legal text was **not** changed except where the previous
milestone already corrected factual overclaims (recorded in
`docs/BRAND-REDESIGN-2026-11.md`). This milestone changed presentation and
metadata only.

## 4. Verification

- `eslint` clean; `tsc --noEmit` clean; **1241/1241 tests pass**; production
  build OK.
- Browser (headless Chromium, local dev server): Terms & Privacy at 1440×900
  (meta chips, sticky TOC scroll-spy, Notice callouts, back-to-top) and
  390×844 (chips wrap cleanly, "On this page · 22 sections" panel opens,
  scroll-spy tracks); zero console/page errors.
- Screenshots committed: `docs/screenshots/brand-redesign/{1440-terms,
  1440-terms-full,1440-terms-ai-notice,390-terms,390-terms-toc,
  390-privacy-full}.png`.

## 5. Git trail (every push verified via `git ls-remote`)

| Commit | Subject |
|---|---|
| `abd7308` | feat(legal-config): owner-configurable last-updated/effective dates with honest fallbacks |
| `bf65888` | feat(legal): professional legal-document layout for Terms & Privacy |
| `0d98a10` | docs(legal): verified browser screenshots |

Base main `c585db4` (PR #28 merge). CI on the tip: run `45119660769` SUCCESS
(push build on `0d98a10`, verified via Actions HTML); two earlier pushes were
cancelled by the workflow's own concurrency policy.

## 6. Remaining gates (honest)

- **PR creation requires the owner's GitHub session** (ADR-008 — deploy keys
  cannot create PRs; the owner opened and merged PRs #27/#28). Compare URL:
  `https://github.com/mrjoker0471/bean-education/compare/main...feat/bean-legal-pages-redesign`.
  Post-merge ledger reconciliation (merge SHA, finalMainSha, syncStatus,
  status → COMPLETE) will be recorded exactly as done for the public-experience
  milestone after PR #27.
- Effective dates and any operator/grievance details remain intentionally
  unset until the owner configures them; the pages display honest pending
  notices and never invent values.
