'use client'

// ─── BEAN Trust & Quality (Phase 6): verified quality display ────────────────
// Small presentation helpers shared by the class detail page and the teacher
// dashboard. Public metrics NEVER show a fabricated zero-star score: below
// the minimum sample the UI says "New teacher — not enough reviews yet".

import { Star } from 'lucide-react'
import type { PublicQualityDTO } from '@/lib/types'

export function RatingStars({ rating, size = 'h-3.5 w-3.5' }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          className={`${size} ${n <= Math.round(rating) ? 'fill-gold text-gold' : 'text-border'}`}
          aria-hidden
        />
      ))}
    </span>
  )
}

/**
 * Public verified-quality line. No sample → honest "not enough reviews"
 * message, never a zero-star rating. Complaint data is never shown here.
 */
export function QualityLine({ quality }: { quality: PublicQualityDTO }) {
  if (!quality.sampleSufficient) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        New teacher — not enough verified reviews yet
      </p>
    )
  }
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <RatingStars rating={quality.averageRating ?? 0} />
        <span className="font-medium text-foreground">{quality.averageRating?.toFixed(1)}</span>
        <span>({quality.reviewCount} verified review{quality.reviewCount === 1 ? '' : 's'})</span>
      </span>
      {quality.completedClasses > 0 && (
        <span>
          · {quality.completedClasses} class{quality.completedClasses === 1 ? '' : 'es'} completed
          {quality.completionRate !== null ? ` (${Math.round(quality.completionRate * 100)}% completion)` : ''}
        </span>
      )}
    </p>
  )
}
