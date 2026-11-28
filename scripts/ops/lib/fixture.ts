// ─── OPS-2D fixture: an isolated disposable backup/restore acceptance set ────
//
// Builds a REAL application-shaped data set on the repository's current Prisma
// schema and migration history:
//   • a real SQLite database built by `prisma migrate deploy` (the exact chain
//     production deploys), never a hand-crafted schema
//   • representative relational data (student → study document → practice
//     test; expert reviewer profile → credential evidence + audit event; a
//     DB-backed session row)
//   • a fixture uploaded document (db/uploads/, absolute storedPath exactly as
//     the app writes it) and fixture credential evidence (db/evidence/,
//     relative storagePath exactly as the app writes it)
//   • one ORPHAN upload (bytes with no DB row — the app's sweep treats aged
//     orphans as debris; backups include all bytes conservatively)
//   • one PURGED evidence row (metadata + hash retained, bytes removed — the
//     app's honest retention state)
//   • known file hashes returned to the caller for end-to-end assertions
//
// No real user data is ever used. Everything is generated deterministically
// from fixed fixture byte strings.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

export interface FixtureFileRecord {
  name: string
  sha256: string
  bytes: number
  referencedBy: string | null
}

export interface BackupFixture {
  root: string
  projectRoot: string
  dbPath: string
  uploadsDir: string
  evidenceDir: string
  uploads: FixtureFileRecord[]
  evidence: FixtureFileRecord[]
  db: {
    studentId: string
    documentId: string
    testId: string
    profileId: string
    activeEvidenceId: string
    purgedEvidenceId: string
    sessionId: string
    /** Present only when built with { extraDocument: true }. */
    secondStudentId?: string
    secondDocumentId?: string
    /** Distinct guestId per document — exercises per-owner route authorization. */
    guestIds: string[]
  }
}

export interface FixtureOptions {
  /** Build a SECOND student/guest/document (the restore path-portability fixture:
   *  two documents with distinct absolute storedPaths + distinct owners so the
   *  remap/canonical proofs and the route-level probe cover more than one row). */
  extraDocument?: boolean
}

const FIXTURE_PDF_BODY =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

const FIXTURE_PNG_BODY = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('BEAN-OPS2-FIXTURE-PNG-credential-evidence\n'),
])

function sha(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function applyMigrationChain(dbPath: string, projectRoot: string): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true })
  execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'pipe',
    timeout: 300_000,
  })
}

export async function buildBackupFixture(root: string, projectRoot: string, options: FixtureOptions = {}): Promise<BackupFixture> {
  const dbPath = path.join(root, 'db', 'custom.db')
  const uploadsDir = path.join(root, 'db', 'uploads')
  const evidenceDir = path.join(root, 'db', 'evidence')
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })

  await applyMigrationChain(dbPath, projectRoot)

  const client = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } })
  try {
    // ── Relational data (representative, FK-consistent) ──
    const student = await client.student.create({
      data: {
        email: 'ops2-fixture@example.invalid',
        displayName: 'OPS-2 Backup Fixture Student',
        role: 'STUDENT',
        ageBand: 'ADULT_18_PLUS',
      },
    })
    const pdfBytes = Buffer.from(FIXTURE_PDF_BODY, 'latin1')
    const documentId = 'ops2doc_fixture_document_0001'
    const storedPath = path.join(uploadsDir, `${documentId}.pdf`) // absolute, exactly as the app writes it
    await writeFile(storedPath, pdfBytes, { mode: 0o600 })
    const document = await client.studyDocument.create({
      data: {
        id: documentId,
        guestId: 'ops2-fixture-guest-0001',
        studentId: student.id,
        title: 'Fixture study document',
        originalName: 'ops2-fixture.pdf',
        storedPath,
        mimeType: 'application/pdf',
        fileSize: pdfBytes.length,
        pageCount: 1,
        status: 'READY',
        contentHash: sha(pdfBytes),
      },
    })
    const test = await client.riisheTest.create({
      data: {
        guestId: 'ops2-fixture-guest-0001',
        studentId: student.id,
        documentId: document.id,
        title: 'Fixture practice test',
        status: 'READY',
        configJson: JSON.stringify({ timed: true, durationMin: 30, marksPerQuestion: 1, negativeMark: false }),
        requestedCount: 5,
      },
    })

    // DB-backed session — proves session state travels inside the DB snapshot.
    const session = await client.session.create({
      data: {
        tokenHash: sha('ops2-fixture-session-token-not-a-real-token'),
        studentId: student.id,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    })

    // Expert reviewer profile + protected credential evidence + audit event.
    const profile = await client.expertReviewerProfile.create({
      data: {
        studentId: student.id,
        reviewerCode: 'OPS2-FIXTURE-RV1',
        category: 'DOMAIN_EXPERT',
        status: 'APPLICATION_PENDING',
        conflictOfInterest: 'none declared (fixture)',
      },
    })
    const evidencePdf = Buffer.from(FIXTURE_PDF_BODY.replace('1.4', '1.7'), 'latin1')
    const evActiveId = 'ev_ops2fixtureactive0000000000000000000'
    const evActivePath = path.join(evidenceDir, `${evActiveId}.pdf`)
    await writeFile(evActivePath, evidencePdf, { mode: 0o600 })
    const evidenceActive = await client.expertCredentialEvidence.create({
      data: {
        id: evActiveId,
        profileId: profile.id,
        kind: 'CV',
        fileName: 'ops2-fixture-cv.pdf',
        byteSize: evidencePdf.length,
        sha256: sha(evidencePdf),
        mimeType: 'application/pdf',
        storagePath: `${evActiveId}.pdf`,
        retentionState: 'ACTIVE',
        uploadedByStudentId: student.id,
      },
    })
    // PURGED evidence: metadata + hash retained, bytes removed (honest retention state).
    const evidencePurged = await client.expertCredentialEvidence.create({
      data: {
        id: 'ev_ops2fixturepurged00000000000000000',
        profileId: profile.id,
        kind: 'CERTIFICATE',
        fileName: 'ops2-fixture-certificate.png',
        byteSize: FIXTURE_PNG_BODY.length,
        sha256: sha(FIXTURE_PNG_BODY),
        mimeType: 'image/png',
        storagePath: 'ev_ops2fixturepurged00000000000000000.png',
        retentionState: 'PURGED',
        purgedAt: new Date(),
        purgedReason: 'fixture withdrawal purge',
        uploadedByStudentId: student.id,
      },
    })
    await client.expertReviewerEvent.create({
      data: {
        profileId: profile.id,
        eventType: 'APPLICATION_SUBMITTED',
        actorKind: 'REVIEWER',
        actorId: student.id,
        rationale: 'fixture application submitted',
        payload: JSON.stringify({ fixture: true }),
      },
    })

    // ORPHAN upload: bytes on disk with no DB row (crash debris the app would sweep).
    const orphanName = 'orphan-no-db-row.pdf'
    const orphanBytes = Buffer.from(FIXTURE_PDF_BODY.replace('1.4', '1.5'), 'latin1')
    await writeFile(path.join(uploadsDir, orphanName), orphanBytes, { mode: 0o600 })

    const uploads: FixtureFileRecord[] = [
      { name: `${documentId}.pdf`, sha256: sha(pdfBytes), bytes: pdfBytes.length, referencedBy: document.id },
      { name: orphanName, sha256: sha(orphanBytes), bytes: orphanBytes.length, referencedBy: null },
    ]
    const guestIds = ['ops2-fixture-guest-0001']
    let secondStudentId: string | undefined
    let secondDocumentId: string | undefined

    // ── Path-portability fixture: a SECOND owner + document whose storedPath is
    // an independent absolute path under the same root. The restore drill uses
    // this to prove multi-row remapping, per-owner route authorization and
    // Range-capable reads through the application's real file-reading logic.
    if (options.extraDocument === true) {
      const secondStudent = await client.student.create({
        data: {
          email: 'ops2-fixture-second@example.invalid',
          displayName: 'OPS-2 Backup Fixture Second Student',
          role: 'STUDENT',
          ageBand: 'ADULT_18_PLUS',
        },
      })
      const secondPdf = Buffer.from(FIXTURE_PDF_BODY.replace('1.4', '1.8'), 'latin1')
      secondDocumentId = 'ops2doc_fixture_document_0002'
      secondStudentId = secondStudent.id
      const secondStoredPath = path.join(uploadsDir, `${secondDocumentId}.pdf`) // absolute, exactly as the app writes it
      await writeFile(secondStoredPath, secondPdf, { mode: 0o600 })
      await client.studyDocument.create({
        data: {
          id: secondDocumentId,
          guestId: 'ops2-fixture-guest-0002',
          studentId: secondStudent.id,
          title: 'Fixture second study document',
          originalName: 'ops2-fixture-second.pdf',
          storedPath: secondStoredPath,
          mimeType: 'application/pdf',
          fileSize: secondPdf.length,
          pageCount: 1,
          status: 'READY',
          contentHash: sha(secondPdf),
        },
      })
      uploads.push({ name: `${secondDocumentId}.pdf`, sha256: sha(secondPdf), bytes: secondPdf.length, referencedBy: secondDocumentId })
      guestIds.push('ops2-fixture-guest-0002')
    }

    return {
      root,
      projectRoot,
      dbPath,
      uploadsDir,
      evidenceDir,
      uploads,
      evidence: [{ name: `${evActiveId}.pdf`, sha256: sha(evidencePdf), bytes: evidencePdf.length, referencedBy: evidenceActive.id }],
      db: {
        studentId: student.id,
        documentId: document.id,
        testId: test.id,
        profileId: profile.id,
        activeEvidenceId: evidenceActive.id,
        purgedEvidenceId: evidencePurged.id,
        sessionId: session.id,
        secondStudentId,
        secondDocumentId,
        guestIds,
      },
    }
  } finally {
    await client.$disconnect()
  }
}

export interface FixtureMutation {
  appendedTo: string
  appendedBytes: number
  newUploadName: string
  newDocumentId: string
  newStudentId: string
}

/**
 * §6 step 10: mutate the ORIGINAL fixture AFTER the backup. The restore drill
 * proves the restored snapshot still matches the manifest (and NOT the mutated
 * source): bytes appended to an existing upload, plus a brand-new student +
 * document + file that the backup must NOT contain.
 */
export async function mutateFixtureAfterBackup(f: BackupFixture): Promise<FixtureMutation> {
  const target = path.join(f.uploadsDir, f.uploads[0].name)
  const appendage = Buffer.from('POST-BACKUP-MUTATION-BYTES\n', 'latin1')
  await appendFile(target, appendage)

  const newPdf = Buffer.from(FIXTURE_PDF_BODY.replace('1.4', '1.6'), 'latin1')
  // IDs deliberately outside the extraDocument fixture's own namespace
  // (the portability fixture already owns ops2doc_fixture_document_0002).
  const newDocumentId = 'ops2doc_fixture_document_0009'
  const newStudentId = 'ops2stu_fixture_student_0009'
  const client = new PrismaClient({ datasources: { db: { url: `file:${f.dbPath}` } } })
  try {
    await client.student.create({
      data: {
        id: newStudentId,
        email: 'ops2-fixture-mutation@example.invalid',
        displayName: 'OPS-2 Post-Backup Mutation Student',
      },
    })
    await client.studyDocument.create({
      data: {
        id: newDocumentId,
        guestId: 'ops2-fixture-guest-0002',
        studentId: newStudentId,
        title: 'Created after the backup was taken',
        originalName: 'ops2-mutation.pdf',
        storedPath: path.join(f.uploadsDir, `${newDocumentId}.pdf`),
        mimeType: 'application/pdf',
        fileSize: newPdf.length,
        status: 'QUEUED',
        contentHash: sha(newPdf),
      },
    })
  } finally {
    await client.$disconnect()
  }
  await writeFile(path.join(f.uploadsDir, `${newDocumentId}.pdf`), newPdf, { mode: 0o600 })
  return {
    appendedTo: f.uploads[0].name,
    appendedBytes: appendage.length,
    newUploadName: `${newDocumentId}.pdf`,
    newDocumentId,
    newStudentId,
  }
}
