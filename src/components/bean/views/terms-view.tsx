'use client'

// ─── Terms and Conditions (public, no sign-in required) ──────────────────────
// Honest scope notes baked into the text:
//   • No payment arrangements, commissions, refund policies or payment
//     providers are described anywhere — payments belong to a later,
//     owner-approved monetisation milestone.
//   • No government approval/certification and no guaranteed compliance or
//     exam results are claimed.
//   • Governing-law wording is explicitly subject to Indian legal review.

import { PolicyPage, type PolicySection } from '@/components/bean/policy-page'
import { api } from '@/lib/api'
import { useEffect, useState } from 'react'

const SECTIONS: PolicySection[] = [
  {
    id: 'operator',
    title: 'Platform operator and contact details',
    body: (
      <>
        <p>
          BEAN Education (&quot;BEAN&quot;, &quot;the platform&quot;) is operated by the legal entity identified in the
          “Platform operator and grievance contact” section at the bottom of this page. The operator&apos;s registered
          identity, consumer-support contact and Grievance Officer details are shown there; details the operator has
          not yet configured are marked honestly rather than filled in.
        </p>
        <p>
          Consumer support, safeguarding and privacy contacts are reachable through the channels listed on this page
          and through the in-product <a href="#/settings">Settings → Privacy</a> request form.
        </p>
      </>
    ),
  },
  {
    id: 'service',
    title: 'Service description and available product features',
    body: (
      <ul>
        <li>
          <strong>Examination catalogue and practice:</strong> browsing a catalogue of examinations, syllabi and
          topics, and taking practice tests with results and explanations.
        </li>
        <li>
          <strong>Riishe AI:</strong> an AI tutor that answers questions, works from documents you upload, supports
          follow-up conversations, evidence-based research sessions and multilingual responses.
        </li>
        <li>
          <strong>Study Workspace:</strong> uploading your study materials, document analysis and a personal material
          library you can resume.
        </li>
        <li>
          <strong>Interactive Learning Studio:</strong> concept maps, step-by-step explanations, formula walkthroughs,
          flashcards, self-marked recall, mini-tests and history/retention controls over your Studio activities.
        </li>
        <li>
          <strong>Personal learning intelligence:</strong> dashboards, progress tracking, study goals, revision
          planning and mistake/weak-topic insights derived from your real activity.
        </li>
        <li>
          <strong>BEAN Teach:</strong> discovering teachers, browsing teacher profiles and classes, booking classes,
          teacher applications and approved-teacher dashboards.
        </li>
        <li>
          <strong>Live classrooms:</strong> real-time online classrooms with attendance and classroom-safety
          capabilities, powered by LiveKit when configured.
        </li>
        <li>
          <strong>Institutions:</strong> an institution workspace with groups, memberships, assignments, resources
          and reports.
        </li>
        <li>
          <strong>Career:</strong> career profiles, portfolios, skills, credentials, opportunities and applications,
          with consent-controlled employer discovery.
        </li>
        <li>
          <strong>BEAN Intelligence:</strong> the BEAN assistant experience.
        </li>
      </ul>
    ),
  },
  {
    id: 'eligibility',
    title: 'Eligibility and account creation',
    body: (
      <>
        <p>
          You may browse the public catalogue without an account, and use guest mode with session-scoped data stored
          for the guest identity on your device. Creating a personal-data account requires accepting the current
          version of these Terms and acknowledging the current{' '}
          <a href="#/privacy">Privacy Policy</a>.
        </p>
        <p>
          <strong>Age:</strong> BEAN supports school-level learners, so users under 18 are expected. Until guardian
          verification is available, personal-data accounts can only be created by users declaring they are 18 or
          older; under-18 users can continue in guest mode. A date of birth is not collected.
        </p>
        <p>You are responsible for the accuracy of the information you provide and for keeping your credentials safe.</p>
      </>
    ),
  },
  {
    id: 'account-types',
    title: 'Student and teacher accounts',
    body: (
      <>
        <p>
          Every normal registration creates a <strong>STUDENT</strong> account. “Student” and “Teacher” in the
          sign-up flow describe the experience you are looking for first — the choice is an onboarding preference,
          never an authorization level.
        </p>
        <p>
          Teacher capability exists only through an approved <strong>TeacherProfile</strong> attached to your account
          (see the next section). One account can be used for both learning and teaching.
        </p>
      </>
    ),
  },
  {
    id: 'teacher-verification',
    title: 'Teacher application and verification',
    body: (
      <>
        <p>
          To teach on BEAN you submit the teacher application with your teaching name, headline, bio, subjects,
          levels, languages, qualifications and experience. Every application is reviewed by an authorised BEAN
          administrator; only approved teachers can publish classes.
        </p>
        <p>
          <strong>You must provide truthful qualifications and information.</strong> Misrepresented qualifications,
          experience or identity are grounds for rejection, suspension or termination. Editing verification-relevant
          details returns an approved profile to review. Decisions and their reasons are recorded in an append-only
          audit history.
        </p>
      </>
    ),
  },
  {
    id: 'teacher-independence',
    title: 'Teacher independence and marketplace responsibilities',
    body: (
      <>
        <p>
          Teachers on BEAN Teach are independent providers of their own classes. BEAN provides discovery, booking,
          classroom tooling and review infrastructure; it does not employ teachers and does not supervise the
          content of individual classes beyond the policies in these Terms.
        </p>
        <p>
          Teachers are responsible for the accuracy of class descriptions, for honouring confirmed bookings and
          cancellation rules, and for complying with applicable law in their teaching activity. BEAN currently does
          not process payments for classes; no commission, payment-split or refund arrangement exists at this stage.
        </p>
      </>
    ),
  },
  {
    id: 'classes',
    title: 'Classes, booking and classroom conduct',
    body: (
      <ul>
        <li>A booking is a commitment between student and teacher: confirmed seats are held, and cancellation rules are shown before you book.</li>
        <li>Live classrooms require teacher-controlled access; participation may be recorded for attendance evidence where the feature is enabled.</li>
        <li>Classroom conduct rules apply to everyone: no harassment, discrimination, disruption or unsafe behaviour. Safeguarding rules (next sections) always apply.</li>
        <li>Reviews may only be written by students who attended a booked class, and are subject to moderation.</li>
      </ul>
    ),
  },
  {
    id: 'responsibilities',
    title: 'User responsibilities and acceptable use',
    body: (
      <ul>
        <li>Do not misuse the platform: no attempts to breach security, scrape at scale, overload services, circumvent rate limits or access other users&apos; data.</li>
        <li>Do not upload unlawful, infringing, harmful or deceptive content.</li>
        <li>Do not impersonate other people, institutions or BEAN staff.</li>
        <li>Do not use the platform to violate examination rules of any examining body.</li>
        <li>Rate limits apply to authentication, AI services, grievances and other sensitive actions.</li>
      </ul>
    ),
  },
  {
    id: 'uploads',
    title: 'Uploaded documents and copyright ownership',
    body: (
      <p>
        <strong>
          You keep ownership of the documents you upload; you must have the appropriate rights or permission to
          upload them.
        </strong>{' '}
        Uploaded files are processed to provide analysis, explanations and practice material for you. You must not
        upload documents you have no right to use — including copyrighted textbooks or paid question banks — without
        permission from the rights holder.
      </p>
    ),
  },
  {
    id: 'ugc',
    title: 'User-generated content and limited platform hosting licence',
    body: (
      <p>
        You retain your rights to content you create on BEAN (reviews, responses, complaints, career portfolios,
        institution resources). You grant BEAN a limited, non-exclusive licence to host, process and display that
        content solely to operate the feature it was submitted to — for example showing a review on a class page or
        an assignment inside an institution group. This licence ends when the content is deleted, except where
        retention is required for safety investigations or legal obligations.
      </p>
    ),
  },
  {
    id: 'ai',
    title: 'AI-generated explanations and limitations',
    body: (
      <>
        <p>
          <strong>AI-generated explanations may contain inaccuracies.</strong> Riishe AI, document-grounded answers,
          research summaries, Studio activities and practice questions are learning aids, not authoritative sources.
          Always verify important statements against your official materials.
        </p>
        <p>
          Riishe works from your uploaded documents and general knowledge; it can misread, hallucinate or omit.
          Research sessions label AI confidence honestly — AI confidence is never verification.
        </p>
      </>
    ),
  },
  {
    id: 'exams',
    title: 'Examination, syllabus and result disclaimers',
    body: (
      <ul>
        <li><strong>Official examination notifications remain authoritative.</strong> Catalogue entries, syllabi and topics are study aids and may lag official changes.</li>
        <li><strong>BEAN does not guarantee examination success</strong> — no result, score or admission outcome is promised by any feature.</li>
        <li>Practice-test results indicate self-assessed performance on those questions only; they are not official scores.</li>
      </ul>
    ),
  },
  {
    id: 'integrity',
    title: 'Academic integrity and misuse',
    body: (
      <p>
        BEAN is designed to help you learn, not to help you cheat. Using AI answers, practice material or Studio
        output to violate an examination&apos;s rules, an institution&apos;s academic-integrity policy or any law is
        misuse of the service. Institutions using group assignments set their own integrity rules; BEAN supports
        their enforcement within the workspace.
      </p>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy and personal-data processing',
    body: (
      <p>
        Personal data is processed as described in the <a href="#/privacy">Privacy Policy</a>, which forms part of
        these Terms. The Privacy Policy explains what is collected, why, which providers receive what, how long it
        is kept, and how to access, export, correct or delete your information.
      </p>
    ),
  },
  {
    id: 'security',
    title: 'Account security and session responsibility',
    body: (
      <p>
        Sessions are maintained with a secure cookie; keep your password confidential and sign out on shared
        devices. You are responsible for activity under your session. If you suspect unauthorised access, change
        your password and contact support; account deletion revokes every active session immediately.
      </p>
    ),
  },
  {
    id: 'suspension',
    title: 'Suspension and termination',
    body: (
      <p>
        BEAN may suspend or terminate access for material breach of these Terms, safeguarding violations, fraud,
        misrepresentation (including teacher qualifications), or unlawful use — with the reason recorded. Where
        safety demands it, suspension may be immediate. You may stop using the platform and delete your account at
        any time from Settings; deletion is described in the next section.
      </p>
    ),
  },
  {
    id: 'export-deletion',
    title: 'Account export and deletion',
    body: (
      <p>
        You can export your personal data as a machine-readable file from <a href="#/settings">Settings</a>, and you
        can delete your account with an explicit typed confirmation (and password re-authentication for password
        accounts). Deletion removes your owned records, revokes all sessions and clears your session cookie. The
        Privacy Policy describes the limited exceptions — security or legal retention where a lawful basis exists —
        and the honest limits of deletion (for example backups).
      </p>
    ),
  },
  {
    id: 'complaints',
    title: 'Complaints, safeguarding and grievance redressal',
    body: (
      <>
        <p>
          Class complaints and safeguarding reports live in <a href="#/trust-policy">Trust &amp; Safety</a>: private
          by design, investigated by authorised administrators, with appeals handled by a different administrator.
        </p>
        <p>
          Privacy and grievance requests (access, correction, erasure, consent, general grievances) are raised via{' '}
          <a href="#/settings">Settings → Privacy</a> and are handled as confidential, owner-scoped tickets. The
          Grievance Officer details are listed at the bottom of this page.
        </p>
      </>
    ),
  },
  {
    id: 'ip',
    title: 'Intellectual property and BEAN trademarks',
    body: (
      <p>
        The BEAN name, logos and platform software are the operator&apos;s intellectual property. Examination names
        and syllabus references belong to their respective examining bodies and are used for identification in the
        catalogue. Nothing in these Terms transfers ownership of either party&apos;s intellectual property.
      </p>
    ),
  },
  {
    id: 'availability',
    title: 'Service availability and limitations',
    body: (
      <p>
        BEAN is provided as-is and as-available. Features may change, and individual capabilities (for example live
        classrooms or Google sign-in) depend on configuration the operator controls. We do not promise uninterrupted
        availability. Where a feature is not configured, the product says so honestly instead of simulating it.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to the Terms',
    body: (
      <p>
        These Terms may change; material changes bump the version shown at the top of this page. Existing users are
        shown a clear re-acceptance screen for material changes — accepting the new version is a deliberate action,
        never implied by signing in. Until re-acceptance, sign-out, data export, account deletion and
        grievance/privacy requests remain fully available.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law and dispute resolution',
    body: (
      <p>
        These Terms are governed by the laws of India, and disputes are subject to the exclusive jurisdiction of
        Indian courts. <strong>This clause and this entire document are subject to Indian legal review before
        public launch</strong> — the operator has not yet completed that review, and no clause here constitutes a
        legal opinion.
      </p>
    ),
  },
]

export function TermsView() {
  const [version, setVersion] = useState<string | null>(null)
  // Draft until the server confirms the owner-configured version.
  const [draft, setDraft] = useState(true)
  useEffect(() => {
    void api.legalConfig().then(c => { setVersion(c.termsVersion); setDraft(c.versionsAreDraft) }).catch(() => undefined)
  }, [])

  return (
    <PolicyPage
      ariaLabel="Terms and Conditions"
      title="Terms and Conditions"
      intro="The rules for using BEAN Education — the examination and study platform, Riishe AI, BEAN Teach, institutions and career tools. Plain language, no invented promises."
      version={version}
      versionsAreDraft={draft}
      sections={SECTIONS}
    />
  )
}
