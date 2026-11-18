// ─── Riishe OCR: genuine Tesseract text recovery for scanned pages ────────────
// SERVER-ONLY module (node:child_process) — never import from client code.
//
// When the OCR engine is installed on the deployment, image-only pages that
// pdf.js cannot read get a real second chance: each requested page is rendered
// to a PNG with pdftoppm (poppler) and read with Tesseract 5. The output is
// validated honestly — text that is too short or mostly garbage fails and the
// page keeps its "scanned / awaiting OCR" status. Nothing here pretends: a
// page is only marked read when usable text actually came out of the engine.
//
// Sandbox layout this module auto-detects:
//   /home/z/.local/bin/tesseract            (wrapper → real binary + LD_LIBRARY_PATH)
//   /home/z/.local/bin/pdftoppm             (poppler 25.03 wrapper)
//   /home/z/.local/ocr/share/tesseract-ocr/5/tessdata   (eng, tam, osd)
// Generic deployments can point TESSERACT_BIN / POPPLER_BIN / TESSDATA_PREFIX
// at their own installations instead.

import { spawn } from 'node:child_process'
import { accessSync, constants as fsConstants, existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── Public types ─────────────────────────────────────────────────────────────

/** Result of the availability probe (cached per process in module scope). */
export interface OcrAvailability {
  /** true only when binaries + tessdata were found AND `--list-langs` succeeded */
  available: boolean
  engine: 'tesseract-5'
  /** tesseract --version output, parsed (best effort) */
  version?: string
  /** always set when available === false — the honest reason */
  reason?: string
  /** languages reported by `tesseract --list-langs` (empty when unavailable) */
  languages: string[]
  /** the tessdata directory that was verified (when available) */
  tessdataDir?: string
}

/** Per-page OCR outcome — every attempted page gets exactly one, never a throw. */
export interface OcrPageResult {
  page: number
  /** OCR_OK = usable text recovered; OCR_FAILED = honest failure (see reason) */
  outcome: 'OCR_OK' | 'OCR_FAILED'
  /** OCR_OK only: the recognized text, trimmed */
  text?: string
  /** OCR_OK only: text.length (recomputed downstream, kept for convenience) */
  chars?: number
  engine: 'tesseract-5'
  /** the `-l` language string used for this page */
  langs: string
  /** wall-clock milliseconds spent on this page (render + recognize) */
  ms: number
  /** OCR_FAILED only: bounded, human-readable reason (no stack traces) */
  reason?: string
}

export interface OcrScannedPagesOptions {
  /** hard cap of OCR'd pages per document (default 60) */
  maxPages?: number
  /** tesseract `-l` string (default 'eng+tam') */
  langs?: string
  /** progress callback — fired after every page so callers can keep the
   *  document row's statusDetail/updatedAt honest during long runs */
  onProgress?: (done: number, total: number, ok: number) => void | Promise<void>
}

export interface OcrScannedPagesResult {
  results: OcrPageResult[]
  availability: OcrAvailability
}

// ─── Bounds & validation thresholds ───────────────────────────────────────────

const OCR_ENGINE = 'tesseract-5' as const
const DEFAULT_LANGS = 'eng+tam'
const RENDER_DPI = 150
const OCR_MAX_PAGES_PER_DOC = 60
/** shared per-page budget: render + recognize together, then the page fails */
const OCR_PAGE_TIMEOUT_MS = 60_000
/** a page only counts as read when its OCR text passes BOTH checks */
const MIN_TEXT_CHARS = 40
const MIN_ALNUM_SPACE_RATIO = 0.3
// stdout/stderr capture is bounded so a pathological page cannot exhaust memory
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 256 * 1024

const TESSDATA_HOME_FALLBACK = join(homedir(), '.local/ocr/share/tesseract-ocr/5/tessdata')

// ─── Availability probe (cached in module scope) ──────────────────────────────

let availabilityCache: Promise<OcrAvailability> | null = null

export async function isOcrAvailable(): Promise<OcrAvailability> {
  if (!availabilityCache) {
    availabilityCache = detectOcrAvailability().catch(err => ({
      available: false,
      engine: OCR_ENGINE,
      reason: `OCR availability check failed: ${err instanceof Error ? err.message : String(err)}`,
      languages: [],
    }))
  }
  return availabilityCache
}

async function detectOcrAvailability(): Promise<OcrAvailability> {
  const unavailable = (reason: string): OcrAvailability => ({
    available: false,
    engine: OCR_ENGINE,
    reason,
    languages: [],
  })

  // 1. tesseract binary: TESSERACT_BIN → $HOME/.local/bin → PATH ("which")
  const tessBin = resolveBinary('TESSERACT_BIN', 'tesseract', join(homedir(), '.local/bin/tesseract'))
  if (!tessBin) {
    return unavailable('Tesseract binary not found (checked TESSERACT_BIN, ~/.local/bin/tesseract and PATH)')
  }

  // 2. pdftoppm binary: POPPLER_BIN → $HOME/.local/bin → PATH ("which")
  const popplerBin = resolveBinary('POPPLER_BIN', 'pdftoppm', join(homedir(), '.local/bin/pdftoppm'))
  if (!popplerBin) {
    return unavailable('pdftoppm (poppler) binary not found (checked POPPLER_BIN, ~/.local/bin/pdftoppm and PATH)')
  }

  // 3. tessdata directory: TESSDATA_PREFIX → the sandbox/home fallback path
  const tessdataDir = resolveTessdataDir()
  if (!tessdataDir) {
    return unavailable(`tessdata directory not found (checked TESSDATA_PREFIX and ${TESSDATA_HOME_FALLBACK})`)
  }

  // 4. The engine must actually work: list its languages with TESSDATA_PREFIX set.
  const langsRes = await runCommand(tessBin, ['--list-langs'], {
    env: { TESSDATA_PREFIX: tessdataDir },
  })
  if (langsRes.error) {
    return unavailable(`tesseract could not be executed: ${langsRes.error}`)
  }
  if (langsRes.code !== 0) {
    return unavailable(`tesseract --list-langs failed (exit ${langsRes.code ?? 'signal ' + langsRes.signal}): ${firstLine(langsRes.stderr) || firstLine(langsRes.stdout) || 'no output'}`)
  }
  const languages = parseLanguageList(langsRes.stdout)
  if (languages.length === 0) {
    return unavailable('tesseract reported no installed languages for the tessdata directory')
  }

  const version = parseVersion(await runCommand(tessBin, ['--version']))

  return { available: true, engine: OCR_ENGINE, version, languages, tessdataDir }
}

/** env var → home candidate → scan PATH (the programmatic `which tesseract`). */
function resolveBinary(envVar: string, name: string, homeCandidate: string): string | null {
  const fromEnv = process.env[envVar]
  if (fromEnv && isExecutableFile(fromEnv)) return fromEnv
  if (isExecutableFile(homeCandidate)) return homeCandidate
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function resolveTessdataDir(): string | null {
  const fromEnv = process.env.TESSDATA_PREFIX
  if (fromEnv && isDirectory(fromEnv)) return fromEnv
  if (isDirectory(TESSDATA_HOME_FALLBACK)) return TESSDATA_HOME_FALLBACK
  return null
}

function isExecutableFile(p: string): boolean {
  try {
    if (!existsSync(p) || !statSync(p).isFile()) return false
    accessSync(p, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** `List of available languages in "…" (N):` followed by one language per line. */
function parseLanguageList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('List of available languages'))
}

function parseVersion(res: { stdout: string; stderr: string }): string | undefined {
  const m = /tesseract\s+v?(\d[\w.]*)/.exec(`${res.stderr}\n${res.stdout}`)
  return m ? m[1] : undefined
}

function firstLine(s: string): string {
  const line = s.split('\n').map(l => l.trim()).find(l => l.length > 0)
  return line ? line.slice(0, 200) : ''
}

// ─── Bounded child-process runner (spawn, never exec; never rejects) ──────────

interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** true when the child was SIGKILLed for exceeding its time budget */
  timedOut: boolean
  /** set when the process could not be spawned at all (ENOENT, EACCES…) */
  error?: string
}

function runCommand(
  bin: string,
  args: string[],
  opts?: { env?: Record<string, string>; timeoutMs?: number; maxStdoutBytes?: number; maxStderrBytes?: number },
): Promise<RunResult> {
  return new Promise(resolve => {
    const stdoutBuf: Buffer[] = []
    const stderrBuf: Buffer[] = []
    let timedOut = false
    let settled = false

    const maxStdout = opts?.maxStdoutBytes ?? MAX_STDOUT_BYTES
    const maxStderr = opts?.maxStderrBytes ?? MAX_STDERR_BYTES

    let child
    try {
      child = spawn(bin, args, {
        env: { ...process.env, ...(opts?.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, error: err instanceof Error ? err.message : String(err) })
      return
    }

    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            child.kill('SIGKILL')
          } catch { /* already gone */ }
        }, opts.timeoutMs)
      : null

    const collect = (sink: Buffer[], counter: { n: number }, max: number, chunk: Buffer) => {
      if (counter.n >= max) return // bounded: drop the tail, never exhaust memory
      const room = max - counter.n
      const piece = chunk.length > room ? chunk.subarray(0, room) : chunk
      sink.push(piece)
      counter.n += piece.length
    }
    const outCounter = { n: 0 }
    const errCounter = { n: 0 }
    child.stdout?.on('data', (c: Buffer) => collect(stdoutBuf, outCounter, maxStdout, c))
    child.stderr?.on('data', (c: Buffer) => collect(stderrBuf, errCounter, maxStderr, c))

    child.on('error', err => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut, error: err.message })
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdoutBuf).toString('utf8'),
        stderr: Buffer.concat(stderrBuf).toString('utf8'),
        timedOut,
      })
    })
  })
}

// ─── Per-page OCR ──────────────────────────────────────────────────────────────

/**
 * OCR exactly the requested pages of the PDF at pdfPath, sequentially
 * (concurrency 1, one child at a time). NEVER throws for per-page failures —
 * every page gets an honest OcrPageResult; only a catastrophic setup failure
 * (e.g. the temp directory cannot be created) rejects, and even then the
 * caller's document processing continues via its own error handling.
 */
export async function ocrScannedPages(
  pdfPath: string,
  pages: { page: number }[],
  opts?: OcrScannedPagesOptions,
): Promise<OcrScannedPagesResult> {
  const langs = (opts?.langs ?? DEFAULT_LANGS).trim() || DEFAULT_LANGS
  const maxPages = Math.max(0, Math.floor(opts?.maxPages ?? OCR_MAX_PAGES_PER_DOC))
  const targets = pages.slice(0, maxPages)

  const availability = await isOcrAvailable()
  if (!availability.available) {
    // Defensive honesty: the pipeline checks availability first; if it ever
    // calls us anyway, every page fails with the real reason instead of throwing.
    return {
      results: targets.map(t => ({
        page: t.page,
        outcome: 'OCR_FAILED' as const,
        engine: OCR_ENGINE,
        langs,
        ms: 0,
        reason: availability.reason ?? 'OCR engine unavailable',
      })),
      availability,
    }
  }

  const results: OcrPageResult[] = []
  if (targets.length === 0) return { results, availability }

  const tessBin = resolveBinary('TESSERACT_BIN', 'tesseract', join(homedir(), '.local/bin/tesseract'))!
  const popplerBin = resolveBinary('POPPLER_BIN', 'pdftoppm', join(homedir(), '.local/bin/pdftoppm'))!
  const tessdataDir = availability.tessdataDir!

  const tmpDir = await mkdtemp(join(tmpdir(), 'riishe-ocr-'))
  let done = 0
  let ok = 0
  try {
    for (const t of targets) {
      const r = await ocrSinglePage(t.page, pdfPath, tmpDir, langs, tessBin, popplerBin, tessdataDir)
      results.push(r)
      done++
      if (r.outcome === 'OCR_OK') ok++
      try {
        await opts?.onProgress?.(done, targets.length, ok)
      } catch { /* progress reporting must never break OCR */ }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => { /* best effort */ })
  }
  return { results, availability }
}

/** One page: render (pdftoppm) → recognize (tesseract) → validate. 60s total. */
async function ocrSinglePage(
  page: number,
  pdfPath: string,
  tmpDir: string,
  langs: string,
  tessBin: string,
  popplerBin: string,
  tessdataDir: string,
): Promise<OcrPageResult> {
  const started = Date.now()
  const deadline = started + OCR_PAGE_TIMEOUT_MS
  const failed = (reason: string): OcrPageResult => ({
    page,
    outcome: 'OCR_FAILED',
    engine: OCR_ENGINE,
    langs,
    ms: Date.now() - started,
    reason,
  })

  try {
    // ── 1. Render ONLY this page at 150 DPI, into its OWN subdirectory so page
    //      N's image can never be confused with another page's leftover.
    //      (pdftoppm names the output <prefix>-N.png, zero-padding the page
    //      number to the document's digit width.)
    const pageDir = join(tmpDir, String(page))
    await mkdir(pageDir, { recursive: true }).catch(() => {})
    const prefix = join(pageDir, 'pg')
    const remainingRender = deadline - Date.now()
    if (remainingRender <= 0) return failed(`page time budget (${OCR_PAGE_TIMEOUT_MS / 1000}s) exhausted`)
    const render = await runCommand(
      popplerBin,
      ['-f', String(page), '-l', String(page), '-r', String(RENDER_DPI), '-png', pdfPath, prefix],
      { timeoutMs: remainingRender, maxStderrBytes: MAX_STDERR_BYTES },
    )
    if (render.timedOut) return failed(`pdftoppm killed after the ${OCR_PAGE_TIMEOUT_MS / 1000}s per-page budget`)
    if (render.error) return failed(`pdftoppm could not be executed: ${render.error}`)
    if (render.code !== 0) {
      return failed(`pdftoppm failed (exit ${render.code}): ${firstLine(render.stderr) || firstLine(render.stdout) || 'no output'}`)
    }
    const pngPath = await findRenderedPng(pageDir, page)
    if (!pngPath) return failed('pdftoppm produced no image for this page')

    // ── 2. Recognize: `tesseract <img> stdout -l <langs> --psm 3`
    const remainingOcr = deadline - Date.now()
    if (remainingOcr <= 0) return failed(`page time budget (${OCR_PAGE_TIMEOUT_MS / 1000}s) exhausted during render`)
    const ocr = await runCommand(
      tessBin,
      [pngPath, 'stdout', '-l', langs, '--psm', '3'],
      { env: { TESSDATA_PREFIX: tessdataDir }, timeoutMs: remainingOcr, maxStdoutBytes: MAX_STDOUT_BYTES, maxStderrBytes: MAX_STDERR_BYTES },
    )
    if (ocr.timedOut) return failed(`tesseract killed after the ${OCR_PAGE_TIMEOUT_MS / 1000}s per-page budget`)
    if (ocr.error) return failed(`tesseract could not be executed: ${ocr.error}`)
    if (ocr.code !== 0) {
      return failed(`tesseract failed (exit ${ocr.code}): ${firstLine(ocr.stderr) || firstLine(ocr.stdout) || 'no output'}`)
    }

    // ── 3. Validate the text honestly: long enough AND mostly real characters
    //      (alphanumeric + whitespace). Garbled output fails and the page
    //      keeps its scanned status — we never claim a read we did not get.
    const text = ocr.stdout.trim()
    if (text.length < MIN_TEXT_CHARS) {
      return failed(`OCR text too short to use (${text.length} chars < ${MIN_TEXT_CHARS})`)
    }
    const usableRatio = (text.match(/[A-Za-z0-9\s]/g) ?? []).length / text.length
    if (usableRatio < MIN_ALNUM_SPACE_RATIO) {
      return failed(`OCR text unusable (alphanumeric+space ratio ${usableRatio.toFixed(2)} < ${MIN_ALNUM_SPACE_RATIO})`)
    }
    return { page, outcome: 'OCR_OK', text, chars: text.length, engine: OCR_ENGINE, langs, ms: Date.now() - started }
  } catch (err) {
    return failed(`OCR failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300))
  }
}

/** pdftoppm zero-pads the page number — match the rendered PNG by its number. */
async function findRenderedPng(tmpDir: string, page: number): Promise<string | null> {
  try {
    const entries = await readdir(tmpDir)
    let loose: string | null = null
    for (const name of entries) {
      const m = /^pg-0*(\d+)\.png$/.exec(name)
      if (!m) continue
      if (Number(m[1]) === page) return join(tmpDir, name)
      if (loose === null) loose = join(tmpDir, name)
    }
    // Single-page render: if only one image exists it can only be this page.
    return loose
  } catch {
    return null
  }
}
