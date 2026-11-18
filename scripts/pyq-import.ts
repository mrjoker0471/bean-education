// ─── PYQ import CLI — Phase 2A ────────────────────────────────────────────────
// Reads a structured PYQ JSON file and POSTs it to the local import API.
//
// Usage:
//   bun scripts/pyq-import.ts <file.json>                       # import
//   bun scripts/pyq-import.ts <file.json> --dry-run             # validate only
//   bun scripts/pyq-import.ts <file.json> --guest-id=importer1  # guest provenance
//   PYQ_BASE_URL=http://localhost:3000 (default) / PYQ_GUEST_ID env supported
//
// The script is standalone (plain fetch, no src imports) so it runs outside the
// Next build with zero path-alias issues. The dry-run validator below is a
// PRE-FLIGHT sanity check only — the server-side /api/pyq/import validation
// remains authoritative for real imports.
//
// EXAMPLE payload (save as /tmp/pyq-sample.json):
// {
//   "paperTitle": "TNPSC Group 2 Prelims 2019 — General Studies",
//   "fileName": "tnpsc-group2-2019-gs.json",
//   "examSlug": "tnpsc-group-2",
//   "examLabel": "TNPSC Group 2",
//   "stageLabel": "Prelims",
//   "subjectLabel": "General Studies",
//   "year": 2019,
//   "session": "2019",
//   "sourceCitation": "TNPSC Group 2A 2019 official preliminary key, Q.101-102",
//   "items": [
//     {
//       "text": "Which Article of the Constitution of India abolishes untouchability?",
//       "options": ["Article 15", "Article 17", "Article 19", "Article 21"],
//       "correctIndex": 1,
//       "explanation": "Article 17 abolishes untouchability; its practice in any form is a punishable offence.",
//       "difficulty": "EASY",
//       "year": 2019,
//       "sourceRef": "Official preliminary answer key 2019, Q.101"
//     },
//     {
//       "text": "Match the following pairs about Sangam literature ports and modern locations.",
//       "options": ["A-2 B-1", "A-1 B-2", "A-3 B-4", "A-4 B-3"],
//       "correctIndex": 0,
//       "explanation": "Musiri corresponded to the west-coast trade documented in Sangam poems.",
//       "difficulty": "MEDIUM",
//       "sourceRef": "Booklet 2, Section B, Q.44"
//     }
//   ]
// }

import { readFileSync } from 'node:fs'

const YEAR_MIN = 1990
const YEAR_MAX = 2035

interface PayloadItem {
  text?: unknown
  options?: unknown
  correctIndex?: unknown
  explanation?: unknown
  difficulty?: unknown
  year?: unknown
  sourceRef?: unknown
  [key: string]: unknown
}

interface Payload {
  paperTitle?: unknown
  fileName?: unknown
  examSlug?: unknown
  examLabel?: unknown
  stageLabel?: unknown
  subjectLabel?: unknown
  year?: unknown
  session?: unknown
  sourceCitation?: unknown
  guestId?: unknown
  items?: unknown
}

// ─── pre-flight checks (mirror of the server rules) ───────────────────────────

function preflightItem(item: PayloadItem, row: number): string | null {
  const fail = (msg: string) => `row ${row}: ${msg}`
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return fail('not an object')
  if (typeof item.text !== 'string') return fail('text must be a string')
  const text = item.text.trim()
  if (text.length < 10 || text.length > 2000) return fail(`text must be 10..2000 chars (got ${text.length})`)
  if (!Array.isArray(item.options)) return fail('options must be an array')
  if (item.options.length < 2 || item.options.length > 6) return fail(`options must have 2..6 items (got ${item.options.length})`)
  for (let i = 0; i < item.options.length; i++) {
    const opt = item.options[i]
    if (typeof opt !== 'string' || !opt.trim()) return fail(`option ${i} must be a non-empty string`)
    if (opt.trim().length > 500) return fail(`option ${i} exceeds 500 chars`)
  }
  const ci = item.correctIndex
  if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0 || ci >= item.options.length) {
    return fail(`correctIndex must be an integer in [0, ${item.options.length - 1}]`)
  }
  if (item.explanation !== undefined && item.explanation !== null) {
    if (typeof item.explanation !== 'string') return fail('explanation must be a string')
    if (item.explanation.trim().length > 4000) return fail('explanation exceeds 4000 chars')
  }
  if (item.difficulty !== undefined && item.difficulty !== null) {
    if (!['EASY', 'MEDIUM', 'HARD'].includes(item.difficulty as string)) return fail('difficulty must be EASY, MEDIUM or HARD')
  }
  if (item.year !== undefined && item.year !== null) {
    if (typeof item.year !== 'number' || !Number.isInteger(item.year) || item.year < YEAR_MIN || item.year > YEAR_MAX) {
      return fail(`year must be an integer ${YEAR_MIN}..${YEAR_MAX}`)
    }
  }
  return null
}

function preflight(payload: Payload): string[] {
  const errors: string[] = []
  if (typeof payload.paperTitle !== 'string' || payload.paperTitle.trim().length < 3 || payload.paperTitle.trim().length > 200) {
    errors.push('paperTitle must be a string of 3..200 chars')
  }
  if (typeof payload.fileName !== 'string' || payload.fileName.trim().length === 0 || payload.fileName.trim().length > 200) {
    errors.push('fileName must be a non-empty string of at most 200 chars')
  }
  if (typeof payload.examSlug !== 'string' || payload.examSlug.trim().length === 0) {
    errors.push('examSlug is required — PYQ rows must attach to a real catalogue exam')
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) errors.push('items must be a non-empty array')
  else if (payload.items.length > 500) errors.push(`items is capped at 500 rows (got ${payload.items.length})`)
  if (Array.isArray(payload.items)) {
    payload.items.forEach((item, i) => {
      const err = preflightItem(item as PayloadItem, i)
      if (err) errors.push(err)
    })
  }
  return errors
}

// ─── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const fileArg = args.find(a => !a.startsWith('--'))
  const guestArg = args.find(a => a.startsWith('--guest-id='))
  const guestId = guestArg ? guestArg.split('=')[1] : (process.env.PYQ_GUEST_ID ?? 'pyq-import-script')
  const baseUrl = process.env.PYQ_BASE_URL ?? 'http://localhost:3000'

  if (!fileArg) {
    console.error('Usage: bun scripts/pyq-import.ts <file.json> [--dry-run] [--guest-id=<id>]')
    process.exit(2)
  }

  let payload: Payload
  try {
    payload = JSON.parse(readFileSync(fileArg, 'utf8')) as Payload
  } catch (err) {
    console.error(`Cannot read/parse ${fileArg}: ${(err as Error).message}`)
    process.exit(2)
  }

  payload.guestId = guestId
  const itemCount = Array.isArray(payload.items) ? payload.items.length : 0
  console.log(`PYQ import${dryRun ? ' (DRY RUN)' : ''}`)
  console.log(`  file:        ${fileArg}`)
  console.log(`  paperTitle:  ${typeof payload.paperTitle === 'string' ? payload.paperTitle : '(missing)'}`)
  console.log(`  examSlug:    ${typeof payload.examSlug === 'string' ? payload.examSlug : '(missing)'}`)
  console.log(`  rows:        ${itemCount}`)
  console.log(`  importedBy:  ${guestId} (guest)`)

  const errors = preflight(payload)
  if (errors.length > 0) {
    console.error('\nPre-flight FAILED:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  console.log('\nPre-flight OK — all rows pass local sanity checks.')

  if (dryRun) {
    console.log('Dry run complete. No data was sent or written. (Server-side validation, hashing,')
    console.log('duplicate detection and catalog-id checks still apply on a real import.)')
    process.exit(0)
  }

  const res = await fetch(`${baseUrl}/api/pyq/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null

  if (!res.ok || !body) {
    console.error(`\nImport FAILED (HTTP ${res.status}):`)
    if (body?.error) console.error(`  ${String(body.error)}`)
    process.exit(1)
  }

  console.log('\nImport complete:')
  console.log(`  batchId:       ${String(body.batchId)}`)
  console.log(`  totalRows:     ${String(body.totalRows)}`)
  console.log(`  createdCount:  ${String(body.createdCount)}`)
  console.log(`  duplicateCount:${String(body.duplicateCount)}`)
  console.log(`  failedCount:   ${String(body.failedCount)}`)
  const errs = Array.isArray(body.errors) ? (body.errors as { row: number; error: string }[]) : []
  for (const e of errs) console.error(`  row ${e.row}: ${e.error}`)
  process.exit(0)
}

void main()
