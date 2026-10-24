# Task 4-b — Agent work record (Z.ai Code, BEAN views)

Task ID: 4-b
Agent: Z.ai Code (topic workspace + test engine + result views)
Date: session of task 4-b
Scope: ONLY the three stub views + new child files. No other existing file was redesigned.

## Files I own (wrote/modified)
- src/components/bean/views/topic-view.tsx (replaced stub)
- src/components/bean/views/test-runner-view.tsx (replaced stub)
- src/components/bean/views/result-view.tsx (replaced stub)
- src/components/bean/format.ts (NEW shared helpers: formatClock, formatDate, optionLetter, pct)

## Emergency build fix (documented deviation)
- src/app/globals.css: `.font-display { … }` → `@utility font-display { … }` (1 hunk, zero visual change).
- Reason: with the currently installed tailwindcss 4.1.18, `@apply font-display` (used by `.note-markdown h2`) hard-fails with "Cannot apply unknown utility class" → every compile of `GET /` returned 500 for ALL views. Registered `font-display` as a real Tailwind v4 utility so both JSX usage and `@apply` work. Verified: GET / 200 afterwards. This fix unblocked the whole app; see worklog.

## Key implementation notes for later agents
- react-hooks/set-state-in-effect (eslint-plugin-react-hooks v6, enabled in Next 16) forbids synchronous setState in effect bodies. Pattern used in ALL three views: loading is DERIVED (`fetchedFor !== attemptId/topicId`); all state writes happen inside promise callbacks / interval callbacks / event handlers only.
- Runner timer: single interval effect; inside the tick callback it updates `nowMs` and auto-submits ONCE when remaining hits 0 (refs: submittingRef, autoSubmittedRef). Clock is server-corrected via `offset = serverNow - Date.now()` captured at load.
- `api.attemptState` returns `{redirect:'result'}` (200) for submitted/timed-out attempts — runner casts to `AttemptStateDTO & { redirect?: string }` and navigates once (redirectedRef).
- `api.attemptResult` 409 body carries `redirect` but api.ts `jsonFetch` only surfaces `error` → ResultView matches `/still in progress/i` on the error message to redirect to the runner (documented deviation; only possible without touching lib files).
- Start-test button label computes REAL numbers: `Math.min(10, questionCount)` questions · same minutes (matches tests/start config), so it reads "10 questions · 10 min" only when ≥10 available.
- lucide-react 0.525 (installed) does NOT export `BookOpenNote` — use FileText.
- Verified end-to-end in a headless browser: topic view (all three layers + empty states), full runner flow (answer/mark/jump/palette/confirm dialog/auto states), result view (score, per-topic progress, review accordion, retake → new attempt, 409 redirect to runner, Ask BEAN context carry). No console errors.

## Known pre-existing issues NOT mine (do not re-fix)
- src/lib/types.ts has no `CatalogResponse` export, but api.ts and home-view.tsx import it (type-only, so runtime is fine; tsc flags it). Files are outside my scope.
- Markdown component does not render GFM tables (notes contain pipe tables) — needs remark-gfm if ever touched; component is shared/owned by task 3.
