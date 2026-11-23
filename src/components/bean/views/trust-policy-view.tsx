'use client'

// ─── BEAN Teach (Phase 6): public Trust & Safety policy ──────────────────────
// Static, honest explanation of how verified reviews, review moderation,
// teacher responses, private complaints, investigations and appeals, class
// cancellations and the free pilot work on BEAN Teach — factually aligned
// with the enforced backend (audited against the Phase 6 implementation):
//   • Attendance is confirmed by the teacher; live-classroom attendance
//     evidence is advisory context shown to teachers, not an automatic gate.
//   • Appeals exist for adverse decisions: a hidden review, a decided
//     complaint and a trust restriction on a teacher profile.
//   • Teacher replies have no creation deadline; the 7-day window applies to
//     editing a posted reply.
//   • "Criticism is never a violation on its own" is stated as BEAN's
//     moderation policy, not as a technical guarantee.
// The safeguarding guidance repeats the exact platform wording — no phone
// numbers or external contacts are invented, and the only interactive
// elements navigate to routes that already exist.

import { ArrowLeft, BadgeCheck, CalendarX, Flag, LifeBuoy, MessagesSquare, Scale, ShieldAlert, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/lib/store'

/** Exact safeguarding guidance wording (kept identical across all surfaces). */
const SAFEGUARDING_GUIDANCE =
  'If anyone is in immediate danger, contact your local emergency services or a trusted adult right away. BEAN operators review safeguarding reports as a priority, but BEAN is not an emergency service.'

export function TrustPolicyView() {
  const navigate = useAppStore(s => s.navigate)

  return (
    <div className="relative">
      {/* Quiet obsidian stage behind the page header */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 obsidian-ambient" />
      <div className="relative mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'home' })}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to home
        </Button>

        <header className="mt-4">
          <p className="mb-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-gold">
            <span aria-hidden className="h-px w-6 bg-gold/40" /> BEAN Teach · Trust &amp; Safety
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Trust &amp; Safety on BEAN Teach
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            How BEAN Teach keeps reviews honest, reports confidential and decisions accountable. This page
            describes the rules the platform actually enforces today — not aspirations.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline" className="border-gold/40 text-gold">Verified reviews only</Badge>
            <Badge variant="outline" className="border-hairline text-muted-foreground">Confidential reports</Badge>
            <Badge variant="outline" className="border-hairline text-muted-foreground">Append-only case history</Badge>
            <Badge variant="outline" className="border-hairline text-muted-foreground">Free pilot</Badge>
          </div>
        </header>

        <div className="mt-8 flex flex-col gap-4">
          <PolicySection icon={BadgeCheck} title="Verified reviews">
            <p>
              Only students whose booking was marked ATTENDED by the teacher can review a class, and only after the
              class has ended. Attendance is confirmed by the teacher: where the live classroom was used, teachers
              are shown server-verified live attendance evidence to inform that decision — the evidence is
              advisory, and the server enforces the teacher&apos;s attendance marking, not raw classroom data. One
              review per booking, rated from 1 to 5.
            </p>
            <p>
              A review can be edited by its author for 7 days after it is posted. Reviewers are always shown as
              “Verified student” — full names and email addresses are never published. A student may optionally
              consent to displaying their chosen display name next to the review.
            </p>
            <p>
              Flagged reviews are excluded from a teacher&apos;s public rating average while moderation is pending,
              and numeric averages are only shown once a teacher has at least three verified reviews — before that
              the profile simply says “New teacher”.
            </p>
            <p className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Verified student</Badge>
              <Badge variant="outline" className="border-gold/40 text-gold">1–5 rating</Badge>
              <Badge variant="outline" className="border-hairline text-muted-foreground">Editable for 7 days</Badge>
            </p>
          </PolicySection>

          <PolicySection icon={Flag} title="Review moderation">
            <p>
              Teachers can flag a review with a reason. Flagged reviews stay visible while BEAN operators review
              them — flagging is a request for human attention, never an automatic removal.
            </p>
            <p>
              Only authorised administrators may hide a review, and only with a documented reason. BEAN&apos;s
              moderation policy is that criticism and negative opinions alone are never grounds for hiding a
              review — this is a policy commitment, and every hide decision records who made it and why.
            </p>
            <p>
              Review authors can always see the current status of their own review and the documented reason.
            </p>
          </PolicySection>

          <PolicySection icon={MessagesSquare} title="Teacher responses">
            <p>
              The teacher who taught the class can post one public reply under a review, at any time after the
              review is posted. The reply can be edited by the teacher for 7 days after it is posted. Teachers can
              never edit a student&apos;s review — only its author can change it.
            </p>
          </PolicySection>

          <PolicySection icon={ShieldAlert} title="Complaints and reports">
            <p>
              Students and teachers can file private reports about a class they booked or taught. Safeguarding,
              harassment and certain other serious concerns can also be reported without linking a class. Reports
              go only to authorised BEAN administrators.
            </p>
            <p>
              Safeguarding, harassment and discrimination reports are handled confidentially by authorised
              administrators with elevated priority: they are marked sensitive at submission, carry a HIGH severity
              the client cannot soften, and surface at the top of the administrator queue.
            </p>
            <p>
              A report never automatically changes ratings, bookings or a teacher&apos;s status — every consequence
              follows a human investigation. The complainant&apos;s identity is never shared with the other party,
              and administrators&apos; internal notes are not shown to complainants.
            </p>
          </PolicySection>

          <PolicySection icon={Scale} title="Investigations and appeals">
            <p>
              Administrators investigate with an append-only case history: entries are added over time and are
              never rewritten or deleted. Complaints can be assigned to a named administrator, escalated, and
              paused while waiting for more information from the complainant.
            </p>
            <p>
              Affected parties can appeal a decided complaint, the hiding of their own review, and a trust
              restriction placed on a teacher profile. The appeal reviewer must be a different administrator than
              the one who made the original decision. Where an appeal succeeds, the recorded restoration is
              documented — history is corrected by appending, not by rewriting.
            </p>
            <p>
              Trust restrictions have real teeth: a paused teacher cannot take new bookings, a suspended teacher
              cannot publish classes, and an emergency stop closes live classrooms — each enforced server-side and
              expiring only when the restriction says so.
            </p>
          </PolicySection>

          <PolicySection icon={CalendarX} title="Class cancellation">
            <p>
              A teacher may cancel a published class. Reservations are released automatically and affected students
              can rebook other classes. A cancelled class cannot take new bookings.
            </p>
          </PolicySection>

          {/* Financial disclosure — deliberate gold callout, it is a pilot-wide fact. */}
          <section className="glass rounded-2xl border border-gold/25 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/15">
                <Wallet className="h-4 w-4 text-gold" aria-hidden />
              </div>
              <h2 className="font-display text-lg font-semibold text-foreground">Free pilot — financial disclosure</h2>
            </div>
            <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-champagne/90">
              <p>
                Every BEAN Teach reservation during this pilot is free. No payment is collected. No teacher payout
                is made. No monetary refund is processed.
              </p>
              <p>
                Planned prices shown on classes are informational metadata only. Monetary refunds will only exist
                in a future paid phase, when payment processing is actually implemented.
              </p>
            </div>
          </section>

          <PolicySection icon={LifeBuoy} title="How to get support">
            <p>
              File a report from the affected booking under My bookings, or open My reports &amp; appeals to follow
              every case you have already filed, including its appeal status. Rate limits keep reports, reviews and
              appeals spam-safe for everyone.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="border-gold/40 bg-transparent text-gold hover:bg-gold/10"
                onClick={() => navigate({ view: 'classes', tab: 'bookings' })}
              >
                Open my bookings
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-gold/40 bg-transparent text-gold hover:bg-gold/10"
                onClick={() => navigate({ view: 'my-reports' })}
              >
                My reports &amp; appeals
              </Button>
            </div>
            <div className="mt-1 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <p className="text-sm text-destructive">{SAFEGUARDING_GUIDANCE}</p>
            </div>
          </PolicySection>
        </div>
      </div>
    </div>
  )
}

/** Card section with a gold icon chip and a clear h2, on a quiet glass surface. */
function PolicySection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="glass-soft rounded-2xl border border-hairline p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
          <Icon className="h-4 w-4 text-gold" aria-hidden />
        </div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}
