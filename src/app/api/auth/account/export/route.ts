import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EXPORT_VERSION = 'bean-export-v2'

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
    const [profile, goals, attempts, documents, tests, chatTurns, masteryRows, planTasks, revisionItems, mistakeRows, actionRows, studioActivities, researchSessions, researchCandidates, teacherProfile, classesTaught, bookings, reviewsWritten, complaintsFiled, appealsFiled, memberships, careerProfile, careerSkills, careerProjects, careerCredentials, careerApplications, legalAcceptances, consentRecords, oauthIdentities] = await Promise.all([
      db.student.findUnique({
        where: { id: student.id },
        select: {
          id: true,
          email: true,
          displayName: true,
          learningLevel: true,
          interestsJson: true,
          preferencesJson: true,
          signupIntent: true,
          ageBand: true,
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
        // Phase 3D: the per-turn teaching preference exports with the turn.
        select: { role: true, content: true, createdAt: true, documentId: true, tutorMode: true, responseLanguage: true },
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
      // Phase 3F: Studio activity history exports with everything else —
      // kind/topic/status context plus the learner evidence (snapshots are
      // self-study content, never mastery data).
      db.riisheStudioActivity.findMany({
        where: { studentId: student.id },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, kind: true, topic: true, status: true, grounding: true, documentTitle: true,
          responseLanguage: true, activityVersion: true, progressJson: true, responsesJson: true,
          resultJson: true, createdAt: true, updatedAt: true, completedAt: true,
        },
      }),
      // Deep-research history (claimed rows carry a plain studentId).
      db.researchSession.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, kind: true, status: true, statusDetail: true,
          inputJson: true, findingsJson: true, summaryJson: true, createdAt: true,
        },
      }),
      db.researchPyqCandidate.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, status: true, examSlug: true, examLabel: true, stageLabel: true,
          subjectLabel: true, topicLabel: true, year: true, questionNumber: true, paperTitle: true,
          sourceUrl: true, sourceTitle: true, createdAt: true,
        },
      }),
      // Teacher identity + teaching data (one account can be student AND teacher).
      db.teacherProfile.findUnique({
        where: { studentId: student.id },
        select: {
          id: true, teachingName: true, headline: true, bio: true, subjectsJson: true,
          levelsJson: true, languagesJson: true, qualificationsText: true, experienceYears: true,
          portfolioUrl: true, verificationStatus: true, isPublished: true, createdAt: true, updatedAt: true,
        },
      }),
      db.classSession.findMany({
        where: { teacherProfile: { studentId: student.id } },
        orderBy: { startsAt: 'desc' },
        select: {
          id: true, title: true, subject: true, targetLevel: true, language: true,
          durationMinutes: true, startsAt: true, timeZone: true, capacity: true,
          bookedCount: true, status: true, createdAt: true,
        },
      }),
      db.classBooking.findMany({
        where: { studentId: student.id },
        orderBy: { bookedAt: 'desc' },
        select: { id: true, classSessionId: true, status: true, bookedAt: true, cancelledAt: true, attendanceMarkedAt: true },
      }),
      db.classReview.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, classSessionId: true, rating: true, title: true, reviewText: true, showDisplayName: true, status: true, createdAt: true },
      }),
      db.teachComplaint.findMany({
        where: { complainantId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, category: true, subject: true, status: true, createdAt: true },
      }),
      db.teachAppeal.findMany({
        where: { appellantId: student.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true },
      }),
      db.organizationMembership.findMany({
        where: { studentId: student.id },
        select: { id: true, organizationId: true, role: true, status: true, activatedAt: true, createdAt: true },
      }),
      // Career workspace.
      db.careerProfile.findUnique({
        where: { studentId: student.id },
        select: { id: true, headline: true, summary: true, preferredRoleTypes: true, preferredSkills: true, preferredLocations: true, workModes: true, visibility: true, updatedAt: true },
      }),
      db.studentCareerSkill.findMany({ where: { studentId: student.id }, orderBy: { position: 'asc' }, select: { id: true, skillName: true, proficiency: true, description: true, verificationLabel: true, sourceRef: true, position: true } }),
      db.careerProject.findMany({ where: { studentId: student.id }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, description: true, category: true, skillsUsed: true, projectUrl: true, startsAt: true, endsAt: true, visibility: true, status: true } }),
      db.careerCredential.findMany({ where: { studentId: student.id }, select: { id: true, credentialName: true, credentialDescription: true, issuerOrganizationId: true, issuedDate: true, expiryDate: true, status: true } }),
      db.careerApplication.findMany({ where: { studentId: student.id }, orderBy: { submittedAt: 'desc' }, select: { id: true, opportunityId: true, status: true, submittedAt: true } }),
      // Legal acceptance history and purpose-specific consents (evidence trail).
      db.legalAcceptance.findMany({
        where: { studentId: student.id },
        orderBy: { acceptedAt: 'desc' },
        select: { id: true, document: true, version: true, acceptedAt: true },
      }),
      db.consentRecord.findMany({
        where: { studentId: student.id },
        orderBy: { grantedAt: 'desc' },
        select: { id: true, purpose: true, granted: true, grantedAt: true, withdrawnAt: true },
      }),
      // Linked OAuth identities (metadata only — no tokens exist).
      db.oAuthIdentity.findMany({
        where: { studentId: student.id },
        select: { id: true, provider: true, subject: true, createdAt: true },
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
        signupIntent: profile.signupIntent,
        ageBand: profile.ageBand,
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
        // Phase 3D: null on user turns / legacy rows — exported verbatim.
        tutorMode: c.tutorMode,
        responseLanguage: c.responseLanguage,
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
      // Phase 3F: persisted Riishe Studio activities (self-study history).
      studioActivities: studioActivities.map(s => ({
        id: s.id,
        kind: s.kind,
        topic: s.topic,
        status: s.status,
        grounding: s.grounding,
        documentTitle: s.documentTitle,
        responseLanguage: s.responseLanguage,
        activityVersion: s.activityVersion,
        progress: jsonish(s.progressJson),
        responses: jsonish(s.responsesJson),
        result: jsonish(s.resultJson),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        completedAt: s.completedAt ? s.completedAt.toISOString() : null,
      })),
      // Deep-research history (claimed rows carry a plain studentId).
      research: researchSessions.map(r => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        status: r.status,
        statusDetail: r.statusDetail,
        input: jsonish(r.inputJson),
        findings: jsonish(r.findingsJson),
        summary: jsonish(r.summaryJson),
        createdAt: r.createdAt.toISOString(),
      })),
      researchCandidates: researchCandidates.map(c => ({
        id: c.id,
        status: c.status,
        examSlug: c.examSlug,
        examLabel: c.examLabel,
        stageLabel: c.stageLabel,
        subjectLabel: c.subjectLabel,
        topicLabel: c.topicLabel,
        year: c.year,
        questionNumber: c.questionNumber,
        paperTitle: c.paperTitle,
        sourceUrl: c.sourceUrl,
        sourceTitle: c.sourceTitle,
        createdAt: c.createdAt.toISOString(),
      })),
      // Teacher identity + teaching data (one account can be student AND teacher).
      teacherProfile: teacherProfile
        ? {
            id: teacherProfile.id,
            teachingName: teacherProfile.teachingName,
            headline: teacherProfile.headline,
            bio: teacherProfile.bio,
            subjects: jsonish(teacherProfile.subjectsJson),
            levels: jsonish(teacherProfile.levelsJson),
            languages: jsonish(teacherProfile.languagesJson),
            qualificationsText: teacherProfile.qualificationsText,
            experienceYears: teacherProfile.experienceYears,
            portfolioUrl: teacherProfile.portfolioUrl,
            verificationStatus: teacherProfile.verificationStatus,
            isPublished: teacherProfile.isPublished,
            createdAt: teacherProfile.createdAt.toISOString(),
            updatedAt: teacherProfile.updatedAt.toISOString(),
          }
        : null,
      classesTaught: classesTaught.map(c => ({
        id: c.id,
        title: c.title,
        subject: c.subject,
        targetLevel: c.targetLevel,
        language: c.language,
        durationMinutes: c.durationMinutes,
        startsAt: c.startsAt.toISOString(),
        timeZone: c.timeZone,
        capacity: c.capacity,
        bookedCount: c.bookedCount,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
      bookings: bookings.map(b => ({
        id: b.id,
        classSessionId: b.classSessionId,
        status: b.status,
        bookedAt: b.bookedAt.toISOString(),
        cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
        attendanceMarkedAt: b.attendanceMarkedAt ? b.attendanceMarkedAt.toISOString() : null,
      })),
      reviewsWritten: reviewsWritten.map(r => ({
        id: r.id,
        classSessionId: r.classSessionId,
        rating: r.rating,
        title: r.title,
        reviewText: r.reviewText,
        showDisplayName: r.showDisplayName,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      complaintsFiled: complaintsFiled.map(c => ({
        id: c.id,
        category: c.category,
        subject: c.subject,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
      appealsFiled: appealsFiled.map(a => ({
        id: a.id,
        targetType: a.targetType,
        targetId: a.targetId,
        reason: a.reason,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
      institutionMemberships: memberships.map(m => ({
        id: m.id,
        organizationId: m.organizationId,
        role: m.role,
        status: m.status,
        activatedAt: m.activatedAt ? m.activatedAt.toISOString() : null,
        createdAt: m.createdAt.toISOString(),
      })),
      career: {
        profile: careerProfile
          ? {
              id: careerProfile.id,
              headline: careerProfile.headline,
              summary: careerProfile.summary,
              preferredRoleTypes: jsonish(careerProfile.preferredRoleTypes),
              preferredSkills: jsonish(careerProfile.preferredSkills),
              preferredLocations: jsonish(careerProfile.preferredLocations),
              workModes: jsonish(careerProfile.workModes),
              visibility: careerProfile.visibility,
              updatedAt: careerProfile.updatedAt.toISOString(),
            }
          : null,
        skills: careerSkills.map(s => ({
          id: s.id,
          skillName: s.skillName,
          proficiency: s.proficiency,
          description: s.description,
          verificationLabel: s.verificationLabel,
          sourceRef: s.sourceRef,
          position: s.position,
        })),
        projects: careerProjects.map(p => ({
          id: p.id,
          title: p.title,
          description: p.description,
          category: p.category,
          skillsUsed: jsonish(p.skillsUsed),
          projectUrl: p.projectUrl,
          startsAt: p.startsAt ? p.startsAt.toISOString() : null,
          endsAt: p.endsAt ? p.endsAt.toISOString() : null,
          visibility: p.visibility,
          status: p.status,
        })),
        credentials: careerCredentials.map(c => ({
          id: c.id,
          credentialName: c.credentialName,
          credentialDescription: c.credentialDescription,
          issuerOrganizationId: c.issuerOrganizationId,
          issuedDate: c.issuedDate.toISOString(),
          expiryDate: c.expiryDate ? c.expiryDate.toISOString() : null,
          status: c.status,
        })),
        applications: careerApplications.map(a => ({
          id: a.id,
          opportunityId: a.opportunityId,
          status: a.status,
          submittedAt: a.submittedAt.toISOString(),
        })),
      },
      // Legal acceptance history and purpose-specific consents (evidence trail).
      legalAcceptances: legalAcceptances.map(l => ({
        id: l.id,
        document: l.document,
        version: l.version,
        acceptedAt: l.acceptedAt.toISOString(),
      })),
      consentRecords: consentRecords.map(c => ({
        id: c.id,
        purpose: c.purpose,
        granted: c.granted,
        grantedAt: c.grantedAt.toISOString(),
        withdrawnAt: c.withdrawnAt ? c.withdrawnAt.toISOString() : null,
      })),
      // Linked OAuth identities (metadata only — no OAuth tokens are stored).
      oauthIdentities: oauthIdentities.map(o => ({
        id: o.id,
        provider: o.provider,
        subject: o.subject,
        createdAt: o.createdAt.toISOString(),
      })),
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
