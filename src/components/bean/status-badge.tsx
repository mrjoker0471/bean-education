'use client'

import { Badge } from '@/components/ui/badge'
import { CheckCircle2, ShieldQuestion, AlertTriangle, Lock, Link2 } from 'lucide-react'

export function SyllabusStatusBadge({ status }: { status: string }) {
  if (status === 'VERIFIED') {
    return (
      <Badge variant="outline" className="gap-1 border-success/40 text-success bg-success/10">
        <CheckCircle2 className="h-3 w-3" /> Syllabus verified
      </Badge>
    )
  }
  if (status === 'PARTIAL') {
    return (
      <Badge variant="outline" className="gap-1 border-gold/40 text-gold bg-gold/10">
        <ShieldQuestion className="h-3 w-3" /> Syllabus — partially mapped
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
      <AlertTriangle className="h-3 w-3" /> Syllabus mapping in progress
    </Badge>
  )
}

const RESOURCE_STATUS_META: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  VERIFIED: { label: 'Link verified', className: 'border-success/40 text-success bg-success/10', icon: <CheckCircle2 className="h-3 w-3" /> },
  PENDING_REVIEW: { label: 'Pending review', className: 'border-gold/40 text-gold bg-gold/10', icon: <AlertTriangle className="h-3 w-3" /> },
  UNREACHABLE: { label: 'Unreachable from our check', className: 'border-border text-muted-foreground bg-muted', icon: <Link2 className="h-3 w-3" /> },
  PAID: { label: 'Paid', className: 'border-border text-muted-foreground bg-muted', icon: <Lock className="h-3 w-3" /> },
}

export function ResourceStatusBadge({ status }: { status: string }) {
  const meta = RESOURCE_STATUS_META[status] ?? RESOURCE_STATUS_META.PENDING_REVIEW
  return (
    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
      {meta.icon} {meta.label}
    </Badge>
  )
}

export function AccessTypeBadge({ access }: { access: string }) {
  if (access === 'PAID') return <Badge variant="outline" className="text-muted-foreground border-border">Paid</Badge>
  if (access === 'REGISTRATION') return <Badge variant="outline" className="text-gold border-gold/40 bg-gold/10">Free — sign-up needed</Badge>
  return <Badge variant="outline" className="text-success border-success/40 bg-success/10">Free</Badge>
}
