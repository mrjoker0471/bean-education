'use client'

import { cn } from '@/lib/utils'

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
  align = 'center',
}: {
  eyebrow?: string
  title: string
  description?: string
  className?: string
  align?: 'center' | 'left'
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' ? 'mx-auto text-center' : 'text-left', className)}>
      {eyebrow && (
        <p className={cn('mb-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-gold', align === 'center' && 'justify-center')}>
          <span aria-hidden className="h-px w-6 bg-gold/40" />
          {eyebrow}
          <span aria-hidden className="h-px w-6 bg-gold/40" />
        </p>
      )}
      <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>
      {description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>}
    </div>
  )
}
