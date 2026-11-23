'use client'

// ─── Privacy Policy (public, India-focused, audit-based) ──────────────────────
// Every disclosure below reflects the ACTUAL implementation (audited against
// the codebase): what is stored, why, which processors receive it, and what
// controls exist. Nothing is claimed that the code does not do:
//   • Providers named are the real ones: the platform's AI SDK provider (the
//     Riishe/BEAN assistant model runtime), LiveKit (when classrooms are
//     configured) and Google (only when Google sign-in is configured). No
//     email provider, analytics or advertising SDK exists in the product.
//   • No claim is made about a provider's training behaviour — the operator
//     must verify that against the actual provider agreement.
//   • Hosting/backup specifics are described honestly as operator-managed.
//   • Deletion is described with its real limits (no "instantly erased
//     everywhere" claim).

import { PolicyPage, Notice, type PolicySection } from '@/components/bean/policy-page'
import { api } from '@/lib/api'
import { useEffect, useState } from 'react'
import type { LegalConfigDTO } from '@/lib/types'

const SECTIONS: PolicySection[] = [
  {
    id: 'scope',
    title: 'Who this policy covers and how to read it',
    body: (
      <>
        <p>
          This policy covers BEAN Education — the web platform and its features: the examination catalogue and
          practice tests, Riishe AI, the Study Workspace, the Interactive Learning Studio, personal learning
          dashboards, BEAN Teach (teacher discovery, bookings and live classrooms), institution workspaces and the
          career workspace.
        </p>
        <p>
          It is written for ordinary students, parents and teachers. It is a good-faith disclosure of what the
          product actually does today, marked honestly where a detail still depends on the operator&apos;s
          configuration or the owner&apos;s legal review.
        </p>
      </>
    ),
  },
  {
    id: 'collected',
    kind: 'privacy',
    title: 'Information we collect',
    body: (
      <>
        <p><strong>Account information</strong> (when you create an account): your email address, an optional display name, your declared audience preference (student or teacher experience — this is a navigation preference, not a role), a self-declaration that you are 18 or older, and your password in a salted, irreversibly hashed form (or none, for Google-only accounts).</p>
        <p><strong>Learning profile and activity:</strong> your chosen learning level, interests and study preferences; practice attempts, scores and answers; study goals; revision and plan records; topic-mastery, mistake and learning-action records derived from your attempts.</p>
        <p><strong>Documents and AI interactions:</strong> study documents you upload (with extracted text used for analysis), Riishe chat conversations, deep-research sessions and findings, and Interactive Learning Studio activities (concept maps, steps, formulas, flashcards, mini-tests and your responses).</p>
        <p><strong>Teaching:</strong> teacher applications (teaching name, headline, bio, subjects, levels, languages, qualifications, experience, optional portfolio link), approved teacher profiles, the classes you create, bookings on your classes, reviews you write or receive, and complaint/appeal records where you are a participant.</p>
        <p><strong>Institutions:</strong> your memberships, roles, submissions and related records in workspaces you join.</p>
        <p><strong>Career:</strong> your career profile, skills, projects, credentials and applications, plus consent settings controlling employer discovery.</p>
        <p><strong>Safety and trust:</strong> reviews, complaints, safeguarding reports and appeals where you are a party, with access restricted by role and confidentiality rules.</p>
        <p><strong>Authentication and security:</strong> session records that keep you signed in (a random token, stored only as a hash), and — when Google sign-in is configured — the Google identity fields needed to authenticate you: your Google account identifier (sub), your verified email and your profile name. Google access or refresh tokens are NOT stored.</p>
        <p><strong>Legal acceptance:</strong> which version of the Terms and Privacy Policy you accepted, when, and your purpose-specific consent choices.</p>
        <p><strong>Guest mode:</strong> when you use BEAN without an account, your session activity is bound to a random guest identifier stored on your device. It carries no email or identity until you claim it into an account.</p>
      </>
    ),
  },
  {
    id: 'not-collected',
    kind: 'privacy',
    title: 'What we deliberately do not collect',
    body: (
      <ul>
        <li>No date of birth — only a self-declared age band at signup.</li>
        <li>No Aadhaar, passports, government-ID scans or other identity documents.</li>
        <li>No advertising or behavioural tracking of any kind — there are no ad trackers on BEAN, and children are never profiled for advertising.</li>
        <li>No payment or financial data — payments are not part of the product at this stage.</li>
        <li>No Google OAuth access/refresh tokens — login only needs the verified identity.</li>
      </ul>
    ),
  },
  {
    id: 'purposes',
    kind: 'privacy',
    title: 'Why we process information (purposes)',
    body: (
      <ul>
        <li><strong>Account authentication:</strong> verifying your credentials or Google identity, creating and renewing sessions, protecting against abuse.</li>
        <li><strong>Learning and examination services:</strong> showing the catalogue, running practice tests, computing results, mastery and revision schedules from your real activity.</li>
        <li><strong>Document analysis and AI assistance:</strong> processing your uploads to answer questions, generate practice and Studio activities, and run research sessions.</li>
        <li><strong>Class discovery and teaching services:</strong> publishing approved teachers&apos; profiles and classes, handling bookings, attendance and reviews.</li>
        <li><strong>Institutional and career services:</strong> running workspaces, assignments, and the career marketplace with consent-controlled discovery.</li>
        <li><strong>Platform safety and grievance handling:</strong> reviewing complaints, safeguarding reports and appeals; tracking resolution honestly.</li>
        <li><strong>Security, troubleshooting and abuse prevention:</strong> rate limiting, audit trails for teacher decisions and trust actions, investigating incidents.</li>
        <li><strong>Legal obligations:</strong> retaining the minimum records required by law where such an obligation exists.</li>
      </ul>
    ),
  },
  {
    id: 'ai-providers',
    kind: 'privacy',
    title: 'AI and third-party providers',
    body: (
      <>
        <p>These are the processors that can receive your information in the current implementation:</p>
        <ul>
          <li>
            <strong>AI provider (Riishe and BEAN assistant):</strong> when you chat with Riishe, generate practice
            material, run a research session or use Studio, the text needed to answer (your question, conversation
            context, relevant extracted document passages, exam/topic context) is sent to the platform&apos;s AI
            model provider to generate the response. Whether that provider uses submitted content for model training
            depends on the operator&apos;s agreement with the provider — BEAN does not claim a guarantee here; the
            operator will document the provider&apos;s terms before public launch.
          </li>
          <li>
            <strong>LiveKit (live classrooms):</strong> when the operator configures live classrooms, audio/video
            media for a class flows through the operator&apos;s LiveKit project. Attendance and safety features are
            BEAN-side. When LiveKit is not configured, classrooms honestly show “not configured” and no media
            leaves the platform.
          </li>
          <li>
            <strong>Google (only when Google sign-in is configured):</strong> starting Google sign-in sends you to
            Google&apos;s accounts page; BEAN receives the ID-token identity fields described above (subject,
            verified email, profile name) for the sole purpose of authenticating you. No Google API data beyond
            the `openid email profile` scopes is requested.
          </li>
          <li>
            <strong>Hosting and database:</strong> the application, its database and uploaded files run on
            infrastructure managed by the operator. Specific hosting locations, backup arrangements and retention
            windows are operator-managed and will be disclosed before public launch; this policy does not invent
            them.
          </li>
        </ul>
        <p><strong>No email provider is currently configured</strong> (BEAN does not send email), and no analytics, advertising or tracking SDKs exist in the product.</p>
      </>
    ),
  },
  {
    id: 'children',
    kind: 'notice',
    title: 'Children and guardian consent',
    body: (
      <>
        <p>
          BEAN supports school-level learners and expects users under 18. BEAN does not collect targeted
          advertising or behavioural profiles of children — there are no ads and no behavioural tracking on the
          platform at all.
        </p>
        <Notice title="Current status — honest">
          <p>
            <strong>Current status (honest):</strong> personal-data accounts require a declaration of being 18 or
            older; under-18 accounts are refused until verifiable parental consent is available, and nothing about an
            under-18 visitor is stored when they are refused. Under-18 users can use guest mode, which stores no
            account data. BEAN never claims a checkbox or email step is “verifiable parental consent”.
          </p>
        </Notice>
        <p>
          <strong>Planned:</strong> a guardian-consent workflow compliant with India&apos;s data-protection law for
          children is designed and will be implemented before the applicable legal commencement date; until it is
          real, the product fails safe rather than pretending verification happened.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    kind: 'privacy',
    title: 'How long we keep information',
    body: (
      <ul>
        <li><strong>Your learning and account data</strong> is kept while your account exists, so your library, mastery and progress survive between sessions.</li>
        <li><strong>Guest data</strong> is kept until you delete it from Settings or it is claimed into an account you then delete.</li>
        <li><strong>Session records</strong> expire after 30 days unless renewed by activity; deleting your account revokes every active session immediately.</li>
        <li><strong>Teacher application history</strong> is append-only while the application exists, including decision records, so review outcomes remain auditable.</li>
        <li><strong>Account deletion</strong> removes your owned records (documents, attempts, chats, research, Studio history, learning records, teaching profile and classes you created, bookings, reviews, complaints and appeals you filed, institution memberships and submissions, career records, consent records, linked OAuth identities and active sessions). Uploaded files are removed from storage.</li>
        <li>
          <strong>Honest limits:</strong> deletion is not described as instantaneous erasure of every copy. Operator
          backups created before a deletion are handled by the operator&apos;s retention policy, and the minimum
          information needed for security investigations, fraud prevention, dispute or complaint resolution or to
          protect other users may be retained where a lawful basis exists — only the necessary fields, for the
          shortest period that serves that purpose, pseudonymised where possible. Those retention windows are
          operator-managed and will be documented before public launch.
        </li>
      </ul>
    ),
  },
  {
    id: 'rights',
    kind: 'rights',
    title: 'Your rights and choices',
    body: (
      <ul>
        <li><strong>Access and export:</strong> download everything you own as a JSON file from <a href="#/settings">Settings → Account → Export my data</a>. The export covers your profile, learning data, documents metadata, chats, research history, Studio activities, teaching data, bookings, reviews, complaints and appeals, institution memberships, career data, legal acceptance history, consents and linked OAuth identities.</li>
        <li><strong>Correction:</strong> edit your profile and preferences directly in onboarding/Settings; teacher application details can be corrected and resubmitted.</li>
        <li><strong>Erasure:</strong> delete your account (typed confirmation plus password re-authentication for password accounts) or wipe guest data — both in Settings. Deletion previews the categories of data removed first.</li>
        <li><strong>Consent withdrawal:</strong> optional purposes are consented to individually and can be withdrawn independently; BEAN currently preselects nothing and bundles nothing.</li>
        <li><strong>Grievance and privacy requests:</strong> raise a confidential, owner-scoped request from <a href="#/settings">Settings → Privacy</a> (categories: access, correction, erasure, consent, grievance).</li>
        <li><strong>Parents and guardians:</strong> until guardian-verified accounts exist, minors are not given personal-data accounts; a parent or lawful guardian can raise a privacy request through the Grievance Officer contact shown on this page about any data they believe was collected from their child.</li>
      </ul>
    ),
  },
  {
    id: 'security',
    kind: 'privacy',
    title: 'How we protect information',
    body: (
      <ul>
        <li>Passwords are stored as salted scrypt hashes and are never logged or returned.</li>
        <li>Sessions use an httpOnly cookie whose token exists only in the cookie — the database stores its hash; a stolen database cannot forge cookies.</li>
        <li>Same-origin protections guard every mutating authentication and account action.</li>
        <li>Google sign-in uses PKCE, state, nonce and full ID-token signature verification; it can never grant a teacher or admin role.</li>
        <li>Ownership is enforced server-side on every read and write; one student can never read or delete another&apos;s data.</li>
        <li>Complaint and safeguarding contents are access-restricted and never logged.</li>
        <li>Rate limits protect authentication, OAuth initiation and grievances.</li>
      </ul>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        Material changes to this policy bump its version and are shown with a clear re-acceptance screen — your
        continued use is never treated as acceptance. Sign-out, export, deletion and grievance requests stay
        available regardless.
      </p>
    ),
  },
]

export function PrivacyView() {
  const [cfg, setCfg] = useState<LegalConfigDTO | null>(null)
  useEffect(() => {
    void api.legalConfig().then(setCfg).catch(() => undefined)
  }, [])

  return (
    <PolicyPage
      ariaLabel="Privacy Policy"
      title="Privacy Policy"
      intro="What BEAN Education collects, why, who receives it, how long it is kept, and the controls you have — written from an audit of what the product actually does, in language students, parents and teachers can read."
      version={cfg?.privacyVersion ?? null}
      versionsAreDraft={cfg ? cfg.versionsAreDraft : true}
      dates={cfg?.dates}
      sections={SECTIONS}
    />
  )
}
