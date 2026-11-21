'use client'

// ─── BEAN Teach (Phase 6): public Trust & Safety policy ──────────────────────
// Static, honest explanation of how verified reviews, review moderation,
// teacher responses, private complaints, investigations and appeals, class
// cancellations and the free pilot work on BEAN Teach. The safeguarding
// guidance repeats the exact platform wording — no phone numbers or external
// contacts are invented, and the only interactive elements navigate to routes
// that already exist.

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
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'home' })}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to home
      </Button>

      <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach · Trust</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Trust & Safety on BEAN Teach</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        How BEAN Teach keeps reviews honest, reports confidential and decisions accountable. This page describes the rules the platform actually enforces — not aspirations.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <PolicySection icon={BadgeCheck} title="Verified reviews">
          <p>
            Only students whose booking was marked ATTENDED by the teacher can review a class, and only after the class has ended. Where available, the server cross-checks live-classroom attendance evidence before a review is allowed. One review per booking, rated from 1 to 5.
          </p>
          <p>
            A review can be edited by its author for 7 days after it is posted. Reviewers are always shown as “Verified student” — full names and email addresses are never published. A student may optionally consent to displaying their chosen display name next to the review.
          </p>
          <p className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Verified student</Badge>
            <Badge variant="outline" className="border-gold/40 text-gold">1–5 rating</Badge>
            <Badge variant="outline" className="border-border text-muted-foreground">Editable for 7 days</Badge>
          </p>
        </PolicySection>

        <PolicySection icon={Flag} title="Review moderation">
          <p>
            Teachers can flag a review with a reason. Flagged reviews stay visible while BEAN operators review them — flagging is a request for human attention, never an automatic removal.
          </p>
          <p>
            Only authorised administrators may hide a review, and only with a documented reason. Criticism and negative opinions are never policy violations on their own.
          </p>
          <p>
            Review authors can always see the current status of their own review, and every moderation decision can be appealed.
          </p>
        </PolicySection>

        <PolicySection icon={MessagesSquare} title="Teacher responses">
          <p>
            The teacher who taught the class can post one public reply under a review, within 7 days of the review being posted. Teachers can never edit a student’s review — only its author can change it.
          </p>
        </PolicySection>

        <PolicySection icon={ShieldAlert} title="Complaints and reports">
          <p>
            Students and teachers can file private reports about a class they booked or taught. Reports go only to authorised BEAN administrators.
          </p>
          <p>
            Safeguarding, harassment and discrimination reports are handled confidentially by authorised administrators with elevated priority.
          </p>
          <p>
            A report never automatically changes ratings, bookings or a teacher’s status — every consequence follows a human investigation. The complainant’s identity is never shared with the other party.
          </p>
        </PolicySection>

        <PolicySection icon={Scale} title="Investigations and appeals">
          <p>
            Administrators investigate with an append-only case history: entries are added over time and are never rewritten or deleted.
          </p>
          <p>
            Affected parties can appeal a complaint decision, the moderation of their own review, and a trust restriction placed on a teacher profile. The appeal reviewer must be a different administrator than the one who made the original decision.
          </p>
        </PolicySection>

        <PolicySection icon={CalendarX} title="Class cancellation">
          <p>
            A teacher may cancel a published class. Reservations are released automatically and affected students can rebook other classes. A cancelled class cannot take new bookings.
          </p>
        </PolicySection>

        {/* Financial disclosure — deliberate gold callout, it is a pilot-wide fact. */}
        <section className="rounded-xl border border-gold/40 bg-gold/10 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/20">
              <Wallet className="h-4 w-4 text-gold" aria-hidden />
            </div>
            <h2 className="font-display text-lg font-semibold text-foreground">Free pilot — financial disclosure</h2>
          </div>
          <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-gold">
            <p>
              Every BEAN Teach reservation during this pilot is free. No payment is collected. No teacher payout is made. No monetary refund is processed.
            </p>
            <p>
              Planned prices shown on classes are informational metadata only. Monetary refunds will only exist in a future paid phase, when payment processing is actually implemented.
            </p>
          </div>
        </section>

        <PolicySection icon={LifeBuoy} title="How to get support">
          <p>
            File a report from the affected booking under My bookings, or open My reports & appeals to follow every case you have already filed, including its appeal status.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="border-gold/40 text-gold hover:bg-gold/10"
              onClick={() => navigate({ view: 'classes', tab: 'bookings' })}
            >
              Open my bookings
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-gold/40 text-gold hover:bg-gold/10"
              onClick={() => navigate({ view: 'my-reports' })}
            >
              My reports & appeals
            </Button>
          </div>
          <div className="mt-1 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <p className="text-sm text-destructive">{SAFEGUARDING_GUIDANCE}</p>
          </div>
        </PolicySection>
      </div>
    </div>
  )
}

/** Card section with a gold icon chip and a clear h2, matching the detail view style. */
function PolicySection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
          <Icon className="h-4 w-4 text-gold" aria-hidden />
        </div>
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}
