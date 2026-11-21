// ─── BEAN Teach (Phase 4A): client-safe formatting helpers ───────────────────
// Pure presentation utilities shared by the teach views. Kept separate from
// src/lib/teach.ts because that module imports the database (server-only).

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Planned regular price in rupees from paise (metadata only — never charged). */
export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

/** Class start rendered in the VIEWER's local time (unambiguous for planning). */
export function formatClassLocal(startsAtIso: string): string {
  return new Date(startsAtIso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The class's own IANA zone rendering (what the teacher scheduled). */
export function formatClassInZone(startsAtIso: string, timeZone: string): string {
  try {
    return new Date(startsAtIso).toLocaleString('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return formatClassLocal(startsAtIso)
  }
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Ends-at helper for attendance gating hints. */
export function classEndTime(startsAtIso: string, durationMinutes: number): Date {
  return new Date(new Date(startsAtIso).getTime() + durationMinutes * 60_000)
}

export const TEACH_LEVEL_LABELS: Record<string, string> = {
  SCHOOL_6_8: 'School 6–8',
  SCHOOL_9_10: 'School 9–10',
  SCHOOL_11_12: 'School 11–12',
  UNDERGRAD: 'Undergraduate',
  POSTGRAD: 'Postgraduate',
  PROFESSIONAL: 'Professional',
  COMPETITIVE: 'Competitive exams',
  SKILL: 'Skill learning',
}

export const TEACH_LEVEL_OPTIONS = Object.entries(TEACH_LEVEL_LABELS).map(([value, label]) => ({ value, label }))

export const FREE_PILOT_PRICE_LABEL = 'Planned regular price — not charged during the free pilot.'

export function bookingStatusBadgeClass(status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return 'border-success/40 bg-success/10 text-success'
    case 'ATTENDED':
      return 'border-success/40 bg-success/10 text-success'
    case 'NO_SHOW':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    case 'CANCELLED':
      return 'border-border bg-elevated text-muted-foreground'
    default:
      return 'border-border text-muted-foreground'
  }
}

export function applicationStatusBadgeClass(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'border-success/40 bg-success/10 text-success'
    case 'PENDING':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'REJECTED':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    default:
      return 'border-border text-muted-foreground'
  }
}

/** IANA zones offered in the schedule picker (practical subset + browser default). */
export const COMMON_TIMEZONES: string[] = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
]

/** The visitor's own IANA zone (fallback UTC) — preselected in the picker. */
export function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
