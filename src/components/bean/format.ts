// Small formatting helpers shared by the test-runner and result views.

/** Seconds → "mm:ss" clock string (mm can exceed 59 for long tests). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** ISO date → human readable date, e.g. "12 Aug 2025". */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Option index → letter badge (A–D, falls back to 1-based number). */
export function optionLetter(index: number): string {
  return 'ABCD'[index] ?? String(index + 1)
}

/** Safe percentage (0–100, rounded). */
export function pct(correct: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((correct / total) * 100)
}
