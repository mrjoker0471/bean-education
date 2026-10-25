// Copies the pdf.js worker from the installed pdfjs-dist package into /public.
// Runs on postinstall so the worker ALWAYS matches the installed library
// version (a version mismatch makes pdf.js refuse to start). Idempotent.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs')
const destDir = join(root, 'public')
const dest = join(destDir, 'pdf.worker.min.mjs')

if (!existsSync(src)) {
  console.warn('[copy-pdf-worker] pdfjs-dist worker not found — skipping (pdfjs-dist not installed?)')
  process.exit(0)
}
mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
console.log('[copy-pdf-worker] pdf.worker.min.mjs copied to /public')
