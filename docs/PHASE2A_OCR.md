# Phase 2A — Genuine OCR for the Riishe document pipeline (BEAN LEARN)

Status: implemented (Tesseract 5 + poppler, spawned as child processes from the
pipeline). This document covers the engine evaluation, setup, pipeline
integration, validation rules, bounds, honest failure states, provenance model
and known limitations.

---

## 1. Engine evaluation — why Tesseract

| Criterion | Tesseract 5 (chosen) | Docling (rejected for now) |
|---|---|---|
| Model download weight | None at runtime. Language packs (`eng.traineddata`, `tam.traineddata`) are small static files already present in the sandbox tessdata dir. | Ships / downloads trained layout & table-transformer model weights (hundreds of MB to GBs); every cold start or new runtime needs the full weights. |
| Runtime deps | Two self-contained CLI binaries (`tesseract`, `pdftoppm`) + a tessdata directory. Spawned with `node:child_process`; no Python runtime, no torch/CPU wheel stack. | Python + heavy ML stack (torch etc.) — a second language runtime and a large dependency surface inside a constrained sandbox. |
| Sandbox fit | Already installed and verified: `/home/z/.local/bin/tesseract` (wrapper that sets `LD_LIBRARY_PATH`), `/home/z/.local/bin/pdftoppm` (poppler 25.03), tessdata at `/home/z/.local/ocr/share/tesseract-ocr/5/tessdata` with `eng`, `osd`, `tam`. `--list-langs` verified. | Not installed; installation would fight the sandbox's size, network and library constraints, and its model downloads are not reproducible offline. |
| Determinism / honesty | Plain text out, easy to validate with deterministic rules; failures are per-page and explicit. | Richer structure (tables/layout) but heavier, slower, and harder to bound per page. |

Decision: Tesseract 5.5.0 via CLI spawn, with poppler's `pdftoppm` as the
renderer (poppler is a different PDF renderer than pdf.js, so a page pdf.js
cannot paint can still render). Docling stays a candidate for a future phase
that needs table/structure-aware OCR; adopting it later only touches
`src/lib/riishe/ocr.ts`.

## 2. Setup

Sandbox (already provisioned, auto-detected by `src/lib/riishe/ocr.ts`):

- `tesseract` 5.5.0 — `/home/z/.local/bin/tesseract`
  (wrapper script; real binary `/home/z/.local/ocr/bin/tesseract`; the wrapper
  sets `LD_LIBRARY_PATH=/home/z/.local/ocr/lib/x86_64-linux-gnu` itself)
- `pdftoppm` (poppler 25.03) — `/home/z/.local/bin/pdftoppm`
- tessdata — `/home/z/.local/ocr/share/tesseract-ocr/5/tessdata` (`eng`, `tam`, `osd`)
- Spawn environment: `TESSDATA_PREFIX=/home/z/.local/ocr/share/tesseract-ocr/5/tessdata`

Resolution order implemented in `isOcrAvailable()` (cached per process):

1. Binaries: `TESSERACT_BIN` env → `$HOME/.local/bin/tesseract` → `PATH` scan
   (the programmatic `which tesseract`). Identical order for `POPPLER_BIN` /
   `pdftoppm`.
2. Tessdata: `TESSDATA_PREFIX` env (must be a directory) →
   `$HOME/.local/ocr/share/tesseract-ocr/5/tessdata`.
3. Proof of life: `tesseract --list-langs` is executed with `TESSDATA_PREFIX`
   set; OCR counts as available only when it exits 0 and reports at least one
   language. `tesseract --version` is parsed best-effort for the version string.

Generic deployments: install `tesseract` + `poppler-utils`, place language
packs in a tessdata dir, and either rely on `PATH` or set:

```bash
TESSERACT_BIN=/usr/bin/tesseract
POPPLER_BIN=/usr/bin/pdftoppm
TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
```

Default OCR language string: `eng+tam` (overridable per call via
`ocrScannedPages(..., { langs })`).

## 3. Pipeline integration

`processDocument()` in `src/lib/riishe/pipeline.ts` gained **Stage 1b**, placed
immediately after Stage 1 (extraction) and before `readablePages` is computed
and persisted, so the OCR-merged pages are stored in `extractionJson` and flow
into structure detection, sectioning, AI analysis and coverage unchanged:

1. Detect scanned pages: `extraction.pages.filter(p => p.scanned)` (pdf.js text
   layer below the 32-char threshold → `scanned: true`, `text: ''`).
2. If any exist and `isOcrAvailable()` reports available: the document row is
   updated to status `EXTRACTING` with an honest `Running OCR on N scanned
   page(s)…` detail, then `ocrScannedPages(doc.storedPath, …)` runs sequentially.
   A progress callback keeps `statusDetail`/`updatedAt` fresh (`… — K done, J
   recovered…`) so long OCR runs cannot be mistaken for a dead job.
3. Merge-back, per result:
   - `OCR_OK` → page becomes `text = OCR text`, `chars` recomputed, `scanned:
     false`, `outcome: 'extracted'`, plus provenance `ocr: true`, `ocrEngine`,
     `ocrLangs`. The page now participates in analysis like any text-layer page.
   - `OCR_FAILED` → page keeps `scanned: true` and stays "awaiting OCR" in
     every coverage/accounting bucket. Never faked.
4. `extraction.scannedPages` / `textChars` are recomputed after the merge.
5. If OCR is unavailable, nothing changes — the pre-OCR behaviour (including
   the `NEEDS_OCR` status paths) is untouched.

Availability-aware wording (all driven by an `OcrStageInfo` record
`{ available, attempted, ok, unattempted }`, threaded into
`needsOcrStatusDetail`, `buildCoverageNote`, `finalStatusDetail` and
`deriveStudyGaps`):

- Scanned pages that got usable OCR text no longer count as "awaiting OCR"
  (they are no longer in `scannedPages` / `scannedPageNumbers`).
- Scanned pages that were attempted but failed read "no usable OCR text (the
  engine ran on N pages…)" — never "OCR is not available".
- Pages never attempted because of the per-document cap are called out as
  "beyond the per-document OCR cap".
- The `NEEDS_OCR` status line distinguishes: OCR ran but produced nothing
  usable / OCR available but no image-only pages existed / OCR not installed
  (original wording preserved for that case).
- The retry API (`POST /api/materials/[id]/retry`) returns an availability-
  aware 409 message for `NEEDS_OCR` documents: with the engine installed it
  points at re-analysing (which now runs real OCR); without it, it says OCR is
  not installed on this deployment.

## 4. Validation rules (what counts as "read")

A page's OCR output is accepted (`OCR_OK`) only when BOTH hold:

- trimmed length ≥ **40 chars**, and
- alphanumeric+space ratio = `[A-Za-z0-9\s]` matches ÷ total length ≥ **0.3**
  (garbled/symbol soup fails).

Anything else → `OCR_FAILED` with a bounded reason string (render failure,
timeout, too-short, unusable ratio, engine error). The ratio check is tuned for
Latin-script output; see limitations.

## 5. Bounds

- **60 pages per document** (`maxPages`, default in `ocrScannedPages`); scanned
  pages beyond the cap are honestly reported as unattempted.
- **150 DPI** render (`pdftoppm -f N -l N -r 150 -png <pdf> <tmpdir>/pg`) — only
  the requested pages are rendered, each into its own temp subdirectory so page
  images can never be confused (poppler zero-pads page numbers).
- **Sequential** processing (concurrency 1) — one child process at a time.
- **60 s per page** shared between render + recognize (deadline; the losing
  child is SIGKILLed).
- stdout/stderr capture is bounded (8 MB / 256 KB) so a pathological page
  cannot exhaust memory; temp dirs are removed in `finally`.

## 6. Honest failure states

- `ocrScannedPages` **never throws** for per-page failures — every attempted
  page yields an `OcrPageResult`; only catastrophic setup errors (e.g. the temp
  directory cannot be created) reject.
- Every result carries `{ page, outcome, text?, chars?, engine: 'tesseract-5',
  langs, ms }` (+ optional `reason` for failures).
- If OCR is unavailable, `ocrScannedPages` returns `OCR_FAILED` results with
  the availability reason instead of pretending; the pipeline checks
  availability first and skips the stage entirely.
- Coverage/statusDetail only ever claim what happened: recovered pages leave
  the "awaiting OCR" buckets; failed pages stay in them with wording that says
  the engine ran and produced nothing usable.

## 7. Provenance model

The original PDF is never modified. The stored extraction (`extractionJson`)
holds one object per page; OCR-sourced pages are distinguishable from PDF
text-layer pages by the optional fields added to `ExtractedPage`
(`src/lib/riishe/extract.ts`):

```ts
ocr?: boolean        // true = text came from Tesseract, not the pdf.js text layer
ocrEngine?: string   // e.g. "tesseract-5"
ocrLangs?: string    // e.g. "eng+tam"
```

`outcome` stays within its existing union (`'extracted'` for pages that ended
up with usable text, `'scanned'` for pages still awaiting OCR, `'failed'` for
pdf.js renderer failures); the `ocr` flag is what marks the text source.
Downstream (topics, facts, formulas) cites physical page numbers as before —
the provenance stays one page-object lookup away.

## 8. Limitations

- **Accuracy on low-quality scans**: skewed, faded or low-DPI scans produce
  garbled text; the validation rules reject the worst, but mildly degraded
  text can pass and will read oddly.
- **Handwriting**: Tesseract 5 is a print-model engine — handwriting is
  effectively unreadable and will usually fail validation (honestly).
- **Non-Latin scripts**: only `eng` + `tam` (+ `osd` orientation detection) are
  installed. The alphanumeric+space ratio check is Latin-oriented, so pages
  whose OCR output is predominantly Tamil can be rejected as "unusable" even
  when the recognition was technically successful. Other scripts need both a
  traineddata pack and a validation-ratio revision.
- **Layout**: `--psm 3` (automatic page segmentation) handles ordinary
  documents; dense multi-column tables can interleave columns. Table-structure
  aware OCR (Docling-class) remains future work.
- **Per-document cap**: documents with more than 60 scanned pages have the
  tail left un-attempted (disclosed in coverage wording).
- Old stored extractions keep their original shape; they gain OCR only when
  the document is re-analysed (full re-analysis, or a partial retry, both of
  which pass through Stage 1b).
