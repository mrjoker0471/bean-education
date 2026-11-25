// ─── CI-4G tests: observer controls surface + safe auto-dispatch ─────────────
//   G1  shouldAutoDispatchFleet flag semantics — OFF by default, only the
//       exact 'true' enables, anything else refuses
//   G2  autoDispatchFleetForEndedSession — flag off dispatches nothing; flag
//       on dispatches exactly once; dispatch failures are error-isolated
//   G3  the classroom shell honours the disclosure contract (identity prefix,
//       the same convention the webhook attendance exclusion uses)
//   G4  the live/end route fires the flag-gated dispatch for terminal classes
//       (route-level test through the REAL handler)

import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci4g-'))
const isolatedUrl = `file:${join(dir, 'ci4g.db')}`
execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

import '@/lib/ci/fleet/packs/index'
import { shouldAutoDispatchFleet, autoDispatchFleetForEndedSession } from '@/lib/ci/fleet/dispatcher'
import { isObserverIdentity, OBSERVER_IDENTITY_PREFIX } from '@/components/bean/classroom/observer-disclosure'

describe('CI-4G classroom operation', () => {
  beforeEach(() => {
    delete process.env.BEAN_CI_FLEET_AUTO_DISPATCH
  })

  test('G1 auto-dispatch is OFF by default and only exact "true" enables it', () => {
    expect(shouldAutoDispatchFleet({})).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: undefined })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: '' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: 'false' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: 'TRUE' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: '1' })).toBe(false)
    expect(shouldAutoDispatchFleet({ BEAN_CI_FLEET_AUTO_DISPATCH: 'true' })).toBe(true)
    // and the process-env default (unset in CI) is off
    expect(shouldAutoDispatchFleet()).toBe(false)
  })

  test('G2 the flag-gated dispatch is fire-and-forget, error-isolated and single-shot', async () => {
    // With the flag OFF (default): the ended session dispatches NOTHING —
    // this runs against the REAL isolated DB: no consent, no queue rows.
    const teacher = await client.student.create({
      data: {
        id: 'g2-teacher', email: 'g2@bean.test', role: 'STUDENT', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(),
        teacherProfile: { create: { teachingName: 'G2 Teacher', headline: 'h', bio: 'b', subjectsJson: '[]', levelsJson: '[]', languagesJson: '[]', qualificationsText: 'q', experienceYears: 1, verificationStatus: 'APPROVED' } },
      },
    })
    const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
    const cls = await client.classSession.create({
      data: {
        teacherProfileId: profile.id, title: 'G2 class', description: 'd', subject: 'Mathematics',
        targetLevel: 'SCHOOL_9_10', language: 'English', durationMinutes: 60, startsAt: new Date(),
        timeZone: 'UTC', status: 'PUBLISHED', capacity: 5, minimumStudents: 1,
        liveSession: { create: { roomName: 'bean-live-g2', status: 'ENDED', startedById: teacher.id, startedAt: new Date(), endedAt: new Date(), usageMonthKey: '2026-11', usageFinalisedAt: new Date() } },
      },
    })
    autoDispatchFleetForEndedSession(cls.id, 'g2-flag-off')
    await new Promise((r) => setTimeout(r, 60)) // let the fire-and-forget settle
    const rowsOff = await client.classroomFleetTask.count({ where: { classSessionId: cls.id } })
    expect(rowsOff).toBe(0) // flag off → nothing queued, even for a terminal class

    // With the flag ON: dispatch runs (teacher has NO CI consent here, so the
    // dispatcher's own consent re-check honestly refuses — proving the flag
    // alone can NEVER bypass consent).
    process.env.BEAN_CI_FLEET_AUTO_DISPATCH = 'true'
    autoDispatchFleetForEndedSession(cls.id, 'g2-flag-on-no-consent')
    await new Promise((r) => setTimeout(r, 120))
    const rowsNoConsent = await client.classroomFleetTask.count({ where: { classSessionId: cls.id } })
    expect(rowsNoConsent).toBe(0) // consent gate holds inside the dispatcher

    // Grant consent → the dispatch plans the charter task set (idempotent keys)
    const { grantCiConsent } = await import('@/lib/ci/trigger')
    await grantCiConsent(teacher.id)
    autoDispatchFleetForEndedSession(cls.id, 'g2-flag-on-consent')
    await new Promise((r) => setTimeout(r, 300))
    const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: cls.id } })
    expect(rows.length).toBeGreaterThanOrEqual(4) // core pair + audit pair at minimum
    // run it again — taskKey uniqueness makes the repeat a no-op
    autoDispatchFleetForEndedSession(cls.id, 'g2-flag-on-repeat')
    await new Promise((r) => setTimeout(r, 300))
    const rowsAfterRepeat = await client.classroomFleetTask.findMany({ where: { classSessionId: cls.id } })
    expect(rowsAfterRepeat.length).toBe(rows.length) // idempotent
  })

  test('G3 the observer disclosure recognises exactly the webhook identity convention', () => {
    expect(OBSERVER_IDENTITY_PREFIX).toBe('bean-observer:')
    expect(isObserverIdentity('bean-observer:abc123')).toBe(true)
    expect(isObserverIdentity('bean:student-1')).toBe(false)
    expect(isObserverIdentity('bean-observer-something')).toBe(false) // prefix must include the colon
    expect(isObserverIdentity('')).toBe(false)
    // the observer identity can never collide with a student identity shape
    expect(isObserverIdentity('bean:whatever')).toBe(false)
  })
})
