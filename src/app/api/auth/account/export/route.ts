import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EXPORT_VERSION = 'bean-export-v1'

/** Parse a stored JSON column for the export; keep the raw string if invalid. */
function jsonish(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// GET — download everything the signed-in student owns as one JSON file.
// Privacy export: no passwordHash, no file bytes, no server-side paths —
// metadata only for documents. Ownership = studentId (claimed guest rows are
// covered automatically once claimed).
export async function GET(_req: NextRequest) {
  const student = await requireStudent()
  if (!student) {
    return NextResponse.json({ error: 'Sign in to export your data.' }, { status: 401 })
  }

  try {
    const [profile, goals, attempts, documents, tests, chatTurns, masteryRows, planTasks, revisionItems, mistakeRows, actionRows] = await Promise.all([
      db.student.findUnique({
        where: { id: student.id },
        select: {
          id: true,
          email: true,
          displayName: true,
          learningLevel: true,
          interestsJson: true,
          preferencesJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.studyGoal.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, examId: true, topicId: true, targetDate: true, status: true, createdAt: true, updatedAt: true },
      }),
      db.attempt.findMany({
        where: { studentId: student.id },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true, title: true, examLabel: true, status: true, score: true, maxScore: true,
          correctCount: true, wrongCount: true, skippedCount: true, startedAt: true, submittedAt: true,
        },
      }),
      db.studyDocument.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, originalName: true, mimeType: true, fileSize: true, pageCount: true,
          status: true, statusDetail: true, examLabel: true, subjectLabel: true, topicLabel: true,
          createdAt: true, updatedAt: true,
        },
      }),
      db.riisheTest.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, status: true, requestedCount: true, createdAt: true },
      }),
      db.riisheChatTurn.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, createdAt: true, documentId: true },
      }),
      // Phase 3B: personal learning intelligence state exports with everything else.
      db.topicMastery.findMany({
        where: { studentId: student.id },
        orderBy: { computedAt: 'desc' },
        select: { topicName: true, examLabel: true, status: true, accuracy: true, evidenceQuestions: true, attemptCount: true, statusReason: true, lastActivityAt: true, computedAt: true },
      }),
      db.studyPlanTask.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { planDate: true, kind: true, title: true, topicName: true, estimatedMinutes: true, priority: true, rationale: true, status: true, completedAt: true, createdAt: true },
      }),
      db.revisionScheduleItem.findMany({
        where: { studentId: student.id },
        orderBy: { nextDueAt: 'asc' },
        select: { topicName: true, examLabel: true, intervalDays: true, repetitions: true, lapses: true, lastOutcome: true, lastReviewedAt: true, nextDueAt: true, misconceptionFlag: true },
      }),
      db.mistakeRecord.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { source: true, topicName: true, chosenIndex: true, correctIndex: true, snapshotJson: true, category: true, categoryReason: true, studentTag: true, note: true, createdAt: true },
      }),
      db.learningAction.findMany({
        where: { studentId: student.id },
        orderBy: { updatedAt: 'desc' },
        select: { actionKey: true, type: true, title: true, reason: true, status: true, snoozedUntil: true, resolvedAt: true, outcomeJson: true, updatedAt: true },
      }),
    ])

    if (!profile) {
      // Session pointed at a deleted account (should not happen — sessions cascade).
      return NextResponse.json({ error: 'Account not found — please sign in again.' }, { status: 401 })
    }

    const payload = {
      format: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      student: {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        learningLevel: profile.learningLevel,
        interests: jsonish(profile.interestsJson),
        preferences: jsonish(profile.preferencesJson),
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      goals: goals.map(g => ({
        id: g.id,
        title: g.title,
        examId: g.examId,
        topicId: g.topicId,
        targetDate: g.targetDate ? g.targetDate.toISOString() : null,
        status: g.status,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
      attempts: attempts.map(a => ({
        id: a.id,
        title: a.title,
        examLabel: a.examLabel,
        status: a.status,
        score: a.score,
        maxScore: a.maxScore,
        correctCount: a.correctCount,
        wrongCount: a.wrongCount,
        skippedCount: a.skippedCount,
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
      })),
      documents: documents.map(d => ({
        id: d.id,
        title: d.title,
        originalName: d.originalName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        pageCount: d.pageCount,
        status: d.status,
        statusDetail: d.statusDetail,
        examLabel: d.examLabel,
        subjectLabel: d.subjectLabel,
        topicLabel: d.topicLabel,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
      riisheTests: tests.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        requestedCount: t.requestedCount,
        createdAt: t.createdAt.toISOString(),
      })),
      riisheChatTurns: chatTurns.map(c => ({
        role: c.role,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
        documentId: c.documentId,
      })),
      learning: {
        mastery: masteryRows.map(m => ({
          topicName: m.topicName,
          examLabel: m.examLabel,
          status: m.status,
          accuracy: m.accuracy,
          evidenceQuestions: m.evidenceQuestions,
          attemptCount: m.attemptCount,
          statusReason: m.statusReason,
          lastActivityAt: m.lastActivityAt ? m.lastActivityAt.toISOString() : null,
          computedAt: m.computedAt.toISOString(),
        })),
        planTasks: planTasks.map(p => ({
          planDate: p.planDate,
          kind: p.kind,
          title: p.title,
          topicName: p.topicName,
          estimatedMinutes: p.estimatedMinutes,
          priority: p.priority,
          rationale: p.rationale,
          status: p.status,
          completedAt: p.completedAt ? p.completedAt.toISOString() : null,
          createdAt: p.createdAt.toISOString(),
        })),
        revisionSchedule: revisionItems.map(r => ({
          topicName: r.topicName,
          examLabel: r.examLabel,
          intervalDays: r.intervalDays,
          repetitions: r.repetitions,
          lapses: r.lapses,
          lastOutcome: r.lastOutcome,
          lastReviewedAt: r.lastReviewedAt ? r.lastReviewedAt.toISOString() : null,
          nextDueAt: r.nextDueAt.toISOString(),
          misconceptionFlag: r.misconceptionFlag,
        })),
        mistakes: mistakeRows.map(m => ({
          source: m.source,
          topicName: m.topicName,
          chosenIndex: m.chosenIndex,
          correctIndex: m.correctIndex,
          snapshot: jsonish(m.snapshotJson),
          category: m.category,
          categoryReason: m.categoryReason,
          studentTag: m.studentTag,
          note: m.note,
          createdAt: m.createdAt.toISOString(),
        })),
        actions: actionRows.map(a => ({
          actionKey: a.actionKey,
          type: a.type,
          title: a.title,
          reason: a.reason,
          status: a.status,
          snoozedUntil: a.snoozedUntil ? a.snoozedUntil.toISOString() : null,
          resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
          outcome: jsonish(a.outcomeJson),
          updatedAt: a.updatedAt.toISOString(),
        })),
      },
    }

    const filename = `bean-export-${new Date().toISOString().slice(0, 10)}.json`
    return NextResponse.json(payload, {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[api/auth/account/export]', err)
    return NextResponse.json({ error: 'Could not build your export — please try again.' }, { status: 500 })
  }
}
