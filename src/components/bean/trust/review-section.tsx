'use client'

// ─── BEAN Trust & Quality (Phase 6): verified review section (class detail) ──
// Client view over GET/POST /api/teach/classes/:id/reviews. All authorization
// is server-side — the UI merely reflects what the API returns:
//   • list: PUBLISHED + FLAGGED (flagged stays visible), own review in any state
//   • composer: only when myEligibility.canReview (server-decided)
//   • teacher response editor: owner teacher only, one response, 7-day edit
//   • flag (owner teacher): queues moderation — never hides automatically
// Reviews render reviewer as "Verified student" (+ consented displayName).
// Plain text only — React escaping, no HTML injection surface.

import { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, Flag, Loader2, MessageSquareReply, PenLine, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { RatingStars } from '@/components/bean/trust/quality-metrics'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { ClassReviewsResponse, PublicReviewDTO } from '@/lib/types'

const RATING_LABELS: Record<number, string> = {
  1: 'Not helpful',
  2: 'Below expectations',
  3: 'Met expectations',
  4: 'Good',
  5: 'Excellent',
}

export function ReviewSection({ classId, isOwnerTeacher }: { classId: string; isOwnerTeacher: boolean }) {
  const authedStudent = useAppStore(s => s.authedStudent)
  const navigate = useAppStore(s => s.navigate)
  const [data, setData] = useState<ClassReviewsResponse | null>(null)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.classReviews(classId)
      .then(res => { setData(res); setLoadFailed(null) })
      .catch(e => setLoadFailed(e instanceof Error ? e.message : 'Could not load reviews.'))
  }, [classId])

  useEffect(() => { load() }, [load])

  if (loadFailed && !data) {
    return (
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Verified reviews</h2>
        <p className="mt-2 text-sm text-destructive" role="alert">{loadFailed}</p>
        <Button variant="outline" size="sm" className="mt-3 border-border text-muted-foreground hover:bg-elevated" onClick={load}>
          Try again
        </Button>
      </section>
    )
  }
  if (!data) {
    return (
      <section className="rounded-xl border border-border bg-card p-5" aria-label="Loading reviews" role="status">
        <h2 className="font-display text-lg font-semibold text-foreground">Verified reviews</h2>
        <Loader2 className="mt-3 h-5 w-5 animate-spin text-gold" />
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">Verified reviews</h2>
        <Badge variant="outline" className="border-border text-muted-foreground">
          {data.reviews.length} review{data.reviews.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Only students the teacher confirmed as attended — with server-verified live attendance evidence where available — can review. Criticism is welcome; moderation keeps it respectful.
      </p>

      {!authedStudent && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          Sign in to review a class you attended.{' '}
          <button className="ml-1 font-medium text-gold underline-offset-2 hover:underline" onClick={() => navigate({ view: 'auth' })}>
            Sign in
          </button>
        </p>
      )}

      {authedStudent && data.myEligibility.canReview && (
        <ReviewComposer classId={classId} onDone={load} />
      )}
      {authedStudent && !data.myEligibility.canReview && data.reviews.length === 0 && data.myEligibility.reason && (
        <p className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted-foreground">{data.myEligibility.reason}</p>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {data.reviews.map(review => (
          <ReviewCard
            key={review.id}
            review={review}
            classId={classId}
            isOwnerTeacher={isOwnerTeacher}
            onChanged={load}
          />
        ))}
        {data.reviews.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No verified reviews yet — reviews appear after the class ends and attendance is confirmed.
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Composer ────────────────────────────────────────────────────────────────

function ReviewComposer({ classId, onDone }: { classId: string; onDone: () => void }) {
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [showName, setShowName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.createReview(classId, {
        rating,
        ...(title.trim() ? { title: title.trim() } : {}),
        reviewText: text,
        showDisplayName: showName,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your review.')
    } finally {
      setBusy(false)
    }
  }

  const valid = rating >= 1 && text.trim().length >= 20 && text.length <= 2000

  return (
    <form
      className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-4"
      onSubmit={e => { e.preventDefault(); if (valid) void submit() }}
      aria-label="Write your verified review"
    >
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <BadgeCheck className="h-4 w-4 text-success" aria-hidden /> Your review will be marked as a verified student
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? '' : 's'} — ${RATING_LABELS[n]}`}
            onClick={() => setRating(n)}
            className={`min-h-[44px] rounded-lg border px-3 text-sm transition-colors ${
              rating >= n ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:bg-elevated'
            }`}
          >
            <span className="inline-flex items-center gap-1">{n} <RatingStars rating={n === 0 ? 0 : n <= rating ? 5 : 0} size="h-3 w-3" /></span>
          </button>
        ))}
        {rating > 0 && <span className="text-xs text-muted-foreground">{RATING_LABELS[rating]}</span>}
      </div>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="review-title" className="text-xs text-muted-foreground">Title (optional)</Label>
          <Input id="review-title" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} className="border-border bg-elevated text-foreground" placeholder="Summarise your experience" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="review-text" className="text-xs text-muted-foreground">
            Your review <span className="text-muted-foreground/70">(20–2000 characters, plain text)</span>
          </Label>
          <Textarea id="review-text" required value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={2000} className="border-border bg-elevated text-foreground" placeholder="What did you learn? How did the teacher help?" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-name" checked={showName} onCheckedChange={setShowName} />
          <Label htmlFor="show-name" className="text-xs text-muted-foreground">Show my display name publicly (otherwise you appear as “Verified student”)</Label>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="mt-3 bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!valid || busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Publish review
      </Button>
    </form>
  )
}

// ─── Single review card ──────────────────────────────────────────────────────

function ReviewCard({
  review,
  classId,
  isOwnerTeacher,
  onChanged,
}: {
  review: PublicReviewDTO
  classId: string
  isOwnerTeacher: boolean
  onChanged: () => void
}) {
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [flagBusy, setFlagBusy] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)
  const [respondOpen, setRespondOpen] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [respondBusy, setRespondBusy] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)

  const flag = async () => {
    setFlagBusy(true)
    setFlagError(null)
    try {
      await api.flagReview(review.id, flagReason)
      setFlagOpen(false)
      setFlagReason('')
      onChanged()
    } catch (e) {
      setFlagError(e instanceof Error ? e.message : 'Could not flag the review.')
    } finally {
      setFlagBusy(false)
    }
  }

  const respond = async () => {
    setRespondBusy(true)
    setRespondError(null)
    try {
      await api.respondToReview(review.id, responseText)
      setRespondOpen(false)
      setResponseText('')
      onChanged()
    } catch (e) {
      setRespondError(e instanceof Error ? e.message : 'Could not post your response.')
    } finally {
      setRespondBusy(false)
    }
  }

  const ownHidden = review.ownStatus === 'HIDDEN'

  return (
    <article className={`rounded-lg border p-4 ${ownHidden ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-elevated'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <RatingStars rating={review.rating} />
        {review.title && <span className="text-sm font-medium text-foreground">{review.title}</span>}
        <span className="text-xs text-muted-foreground">
          {new Date(review.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
        {review.editedAt && <span className="text-[11px] text-muted-foreground/70">(edited)</span>}
        {/* Own moderation status — visible to the author only (server-gated). */}
        {review.ownStatus === 'FLAGGED' && (
          <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold"><ShieldQuestion className="mr-1 h-3 w-3" aria-hidden />Under moderation — still visible</Badge>
        )}
        {ownHidden && <Badge variant="outline" className="border-destructive/40 text-destructive">Hidden by moderation</Badge>}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {review.reviewer.displayName ? `${review.reviewer.displayName} · ` : ''}{review.reviewer.label}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{review.reviewText}</p>
      {ownHidden && review.ownModerationReason && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Moderation reason: {review.ownModerationReason}
        </p>
      )}

      {review.response && (
        <div className="mt-3 rounded-md border border-gold/30 bg-gold/5 px-3 py-2.5">
          <p className="text-xs font-medium text-gold">Teacher&apos;s response</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{review.response.responseText}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {new Date(review.response.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            {review.response.editedAt ? ' · edited' : ''}
          </p>
        </div>
      )}

      {/* Owner teacher controls: one response per review + flag for moderation. */}
      {isOwnerTeacher && !review.response && !ownHidden && (
        <div className="mt-3">
          {respondOpen ? (
            <div className="rounded-md border border-border p-3">
              <Label htmlFor={`respond-${review.id}`} className="text-xs text-muted-foreground">Your public response (20–1000 characters)</Label>
              <Textarea
                id={`respond-${review.id}`}
                value={responseText}
                onChange={e => setResponseText(e.target.value)}
                rows={3}
                maxLength={1000}
                className="mt-1.5 border-border bg-elevated text-foreground"
                placeholder="Thank the student, add context, or explain what you changed. Keep it professional — no retaliation."
              />
              {respondError && <p className="mt-1.5 text-sm text-destructive" role="alert">{respondError}</p>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={respondBusy || responseText.trim().length < 20} onClick={() => void respond()}>
                  {respondBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Post response
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setRespondOpen(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setRespondOpen(true)}>
              <MessageSquareReply className="mr-1.5 h-3.5 w-3.5" aria-hidden />Respond
            </Button>
          )}
        </div>
      )}
      {isOwnerTeacher && !ownHidden && (
        <div className="mt-2">
          {flagOpen ? (
            <div className="rounded-md border border-border p-3">
              <Label htmlFor={`flag-${review.id}`} className="text-xs text-muted-foreground">Why should moderators look at this review? (10–600 characters)</Label>
              <Textarea
                id={`flag-${review.id}`}
                value={flagReason}
                onChange={e => setFlagReason(e.target.value)}
                rows={2}
                maxLength={600}
                className="mt-1.5 border-border bg-elevated text-foreground"
                placeholder="Describe the policy concern. Flagging keeps the review visible while moderators check it."
              />
              {flagError && <p className="mt-1.5 text-sm text-destructive" role="alert">{flagError}</p>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={flagBusy || flagReason.trim().length < 10} onClick={() => void flag()}>
                  {flagBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Send to moderation
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setFlagOpen(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-elevated" onClick={() => setFlagOpen(true)}>
              <Flag className="mr-1.5 h-3.5 w-3.5" aria-hidden />Flag for moderation
            </Button>
          )}
        </div>
      )}

      {/* Author edit entry — full editor appears only inside the 7-day window. */}
      {review.canEdit && <EditReviewButton review={review} classId={classId} onChanged={onChanged} />}
    </article>
  )
}

function EditReviewButton({ review, onChanged }: { review: PublicReviewDTO; classId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(review.rating)
  const [text, setText] = useState(review.reviewText)
  const [showName, setShowName] = useState(review.reviewer.displayName !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.editReview(review.id, { rating, reviewText: text, showDisplayName: showName })
      setOpen(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your review.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="mt-2 text-muted-foreground hover:bg-elevated" onClick={() => setOpen(true)}>
        <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />Edit your review
      </Button>
    )
  }
  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Edit rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} stars`}
            onClick={() => setRating(n)}
            className={`min-h-[44px] rounded-lg border px-3 text-sm ${rating >= n ? 'border-gold bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:bg-elevated'}`}
          >
            {n}
          </button>
        ))}
      </div>
      <Textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000} className="mt-2 border-border bg-elevated text-foreground" aria-label="Edit review text" />
      <div className="mt-2 flex items-center gap-2">
        <Switch id={`edit-show-name-${review.id}`} checked={showName} onCheckedChange={setShowName} />
        <Label htmlFor={`edit-show-name-${review.id}`} className="text-xs text-muted-foreground">Show my display name</Label>
      </div>
      {error && <p className="mt-1.5 text-sm text-destructive" role="alert">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || text.trim().length < 20} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}Save changes
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}
