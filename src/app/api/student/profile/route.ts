// GET  /api/student/profile — signed-in student profile (guests: 401)
// PATCH /api/student/profile — same-origin + signed-in; partial update of
// displayName / learningLevel / interests / preferences / onboarding completion.
//
// Response DTOs (documented for the UI client):
//   GET   → { student: StudentProfileDTO }
//   PATCH → { student: StudentProfileDTO }   (same shape, after update)
//
// PATCH semantics (documented superset of the minimal contract):
//   • omitted field       → unchanged
//   • displayName: null   → clears the display name (nullable column)
//   • learningLevel: null → clears the level
//   • interests: array    → REPLACES the whole list (trimmed, empty-after-trim
//                           items dropped, deduped, order kept; >60-char items
//                           and >20-item arrays are rejected with 400)
//   • preferences         → MERGED into the stored object; a null value inside
//                           preferences clears that single key
//   • onboardingComplete: true → stamps onboardedAt (once; later PATCHes keep
//                           the original timestamp)
//
// SECURITY (Phase 2B): role is NOT part of this schema — there is no way to
// change a role through profile updates. Roles change only via the operator CLI.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Type-only export — erased at compile time, safe for a Route Handler file.
export interface StudentProfileDTO {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  interests: string[]
  preferences: Record<string, unknown>
  /** ISO timestamp when onboarding finished; null while never completed. */
  onboardedAt: string | null
}

const LEARNING_LEVELS = [
  'SCHOOL_6_8',
  'SCHOOL_9_10',
  'SCHOOL_11_12',
  'UNDERGRAD',
  'POSTGRAD',
  'PROFESSIONAL',
  'COMPETITIVE',
  'SKILL',
] as const

// Student groups (Phase 2B onboarding). Deliberately broader than the exam
// catalogue: BEAN serves school, college and university students, professional
// course candidates (CA/CMA/CS), competitive-exam aspirants, skill learners and
// career developers. No group is forced into an entrance/government-exam box.
export const EDUCATION_CATEGORIES = [
  'SCHOOL',
  'COLLEGE',
  'UNIVERSITY',
  'CA_CMA_CS',
  'COMPETITIVE',
  'SKILL',
  'CAREER',
] as const

// How the student prefers to study (drives presentation nudges only — never
// gates content).
export const LEARNING_STYLES = [
  'CONCEPT_FIRST',
  'PRACTICE_FIRST',
  'VISUAL',
  'REVISE_OFTEN',
] as const

const STUDENT_SELECT = {
  id: true,
  email: true,
  displayName: true,
  learningLevel: true,
  interestsJson: true,
  preferencesJson: true,
  onboardedAt: true,
} as const

type StudentRow = {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  interestsJson: string | null
  preferencesJson: string | null
  onboardedAt: Date | null
}

// ─── Defensive JSON parsing (stored JSON must never be trusted) ───────────────

function parseInterests(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function parsePreferences(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function toStudentDTO(row: StudentRow): StudentProfileDTO {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    learningLevel: row.learningLevel,
    interests: parseInterests(row.interestsJson),
    preferences: parsePreferences(row.preferencesJson),
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
  }
}

function unauthorized() {
  return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const auth = await requireStudent()
    if (!auth) return unauthorized()
    const row = await db.student.findUnique({ where: { id: auth.id }, select: STUDENT_SELECT })
    if (!row) return unauthorized() // session points at a deleted student — treat as signed out
    return NextResponse.json({ student: toStudentDTO(row) })
  } catch (err) {
    console.error('[api/student/profile GET]', err)
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────────

// zod v4 runs checks in chain order: .trim() applies BEFORE .min()/.max(),
// so lengths are validated against the trimmed value (verified in-session).
const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
  learningLevel: z.enum(LEARNING_LEVELS).nullable().optional(),
  interests: z.array(z.string().trim().max(60)).max(20).optional(),
  preferences: z
    .object({
      dailyMinutes: z.number().int().min(0).max(480).nullable().optional(),
      language: z.string().trim().min(1).max(40).nullable().optional(),
      revisionStyle: z.string().trim().min(1).max(40).nullable().optional(),
      goalExam: z.string().trim().min(1).max(120).nullable().optional(),
      educationCategory: z.enum(EDUCATION_CATEGORIES).nullable().optional(),
      learningStyle: z.enum(LEARNING_STYLES).nullable().optional(),
    })
    .optional(),
  onboardingComplete: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    }
    const auth = await requireStudent()
    if (!auth) return unauthorized() // guests can never PATCH

    const raw: unknown = await req.json().catch(() => null)
    if (raw === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const parsed = patchSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid profile update' }, { status: 400 })
    }
    const { displayName, learningLevel, interests, preferences, onboardingComplete } = parsed.data

    const row = await db.student.findUnique({ where: { id: auth.id }, select: STUDENT_SELECT })
    if (!row) return unauthorized()

    const data: {
      displayName?: string | null
      learningLevel?: string | null
      interestsJson?: string
      preferencesJson?: string
      onboardedAt?: Date
    } = {}

    if (displayName !== undefined) data.displayName = displayName
    if (learningLevel !== undefined) data.learningLevel = learningLevel
    if (interests !== undefined) {
      // trimmed by zod; drop items that are empty after trim; dedupe (order kept)
      data.interestsJson = JSON.stringify([...new Set(interests.filter(i => i.length > 0))])
    }
    if (preferences !== undefined) {
      const merged = parsePreferences(row.preferencesJson)
      for (const [key, value] of Object.entries(preferences)) {
        if (value === undefined) continue
        if (value === null) delete merged[key]
        else merged[key] = value
      }
      data.preferencesJson = JSON.stringify(merged)
    }
    // Onboarding completion is a one-way stamp: the FIRST completion time is
    // kept forever (a later profile edit never resets the flag).
    if (onboardingComplete === true && row.onboardedAt === null) {
      data.onboardedAt = new Date()
    }

    // Nothing to change → return the current profile without a write.
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ student: toStudentDTO(row) })
    }

    const updated = await db.student.update({ where: { id: auth.id }, data, select: STUDENT_SELECT })
    return NextResponse.json({ student: toStudentDTO(updated) })
  } catch (err) {
    console.error('[api/student/profile PATCH]', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
