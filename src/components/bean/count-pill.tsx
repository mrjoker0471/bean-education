'use client'

import { cn } from '@/lib/utils'

export function CountPill({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-hairline glass-soft px-2.5 py-1 text-xs text-muted-foreground', className)}>
      <span className="font-semibold text-champagne">{value}</span> {label}
    </span>
  )
}
