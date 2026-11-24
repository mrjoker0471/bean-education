'use client'

// ─── BEAN Education brand assets ─────────────────────────────────────────────
// The supplied artwork is the single source of brand identity:
//   • /brand/bean-emblem.png   — complete stacked logo (graduation-cap "B"
//     emblem). Used wherever a full brand presentation is appropriate (auth
//     screens, loading/empty stages, footer emblem, favicon source).
//   • /brand/bean-wordmark.png — horizontal BEAN EDUCATION wordmark. Used in
//     the header lockup and footer. NEVER recreated with HTML text or fonts.
//   • /brand/bean-icon.png     — square favicon derived from the emblem.
//
// Every image renders with object-contain so the artwork is never cropped,
// stretched or distorted, and preserves its original aspect ratio. The old
// text-based wordmark and the placeholder bean-tile SVG were removed so the
// two can never appear together (no duplicated branding).

import { cn } from '@/lib/utils'

export function BeanEmblem({ className, alt = 'BEAN Education emblem' }: { className?: string; alt?: string }) {
  return (
    <img
      src="/brand/bean-emblem.png"
      alt={alt}
      draggable={false}
      className={cn('object-contain select-none', className)}
    />
  )
}

export function BeanWordmarkImage({ className, alt = 'BEAN Education' }: { className?: string; alt?: string }) {
  return (
    <img
      src="/brand/bean-wordmark.png"
      alt={alt}
      draggable={false}
      className={cn('object-contain select-none', className)}
    />
  )
}

/**
 * The header brand lockup: the complete emblem artwork with the supplied
 * horizontal wordmark immediately beside it, sitting directly on the normal
 * header background — no enclosing box, no card, no border, no background,
 * no card-like shadow, no container glow or container hover effect (design
 * correction, CI-2 homepage redesign). The emblem and wordmark are vertically
 * aligned with a natural gap; both keep their original aspect ratios and are
 * never cropped or stretched. On the smallest screens the lockup scales down
 * but the complete wordmark stays readable.
 */
export function BrandLockup({ onClick, className }: { onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="BEAN Education home"
      className={cn(
        'flex items-center gap-2.5 transition-opacity duration-200 hover:opacity-85',
        className,
      )}
    >
      <BeanEmblem alt="" className="h-9 w-9 shrink-0 sm:h-10 sm:w-10" />
      <BeanWordmarkImage
        alt="BEAN Education"
        className="h-[18px] w-auto min-w-[118px] sm:h-5 sm:min-w-[132px] lg:h-[22px] lg:min-w-[146px]"
      />
    </button>
  )
}

/** Compact lockup for the mobile navigation sheet and the footer. */
export function BrandLockupCompact({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BeanEmblem alt="" className="h-7 w-7 shrink-0" />
      <BeanWordmarkImage alt="BEAN Education" className="h-[15px] w-auto min-w-[100px]" />
    </span>
  )
}
