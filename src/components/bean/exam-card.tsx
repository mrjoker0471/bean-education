'use client'

import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CountPill } from './count-pill'
import { SyllabusStatusBadge } from './status-badge'
import { ArrowRight, MapPin } from 'lucide-react'
import type { ExamListItem } from '@/lib/types'
import { navigateExam } from '@/lib/store'

export function ExamCard({ exam }: { exam: ExamListItem }) {
  return (
    <Card className="exam-card-hover flex h-full flex-col border-border bg-card">
      <CardHeader className="pb-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-gold/30 bg-gold/5 text-gold">
            {exam.shortName ?? exam.name.split(' ').slice(0, 3).join(' ')}
          </Badge>
          {exam.state && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> {exam.state}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigateExam(exam.slug)}
          className="text-left font-display text-lg font-semibold leading-snug text-foreground hover:text-gold"
          aria-label={`Open ${exam.name}`}
        >
          {exam.name}
        </button>
        <p className="mt-1 text-xs text-muted-foreground">By {exam.authority}</p>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{exam.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <CountPill label="topics" value={exam.counts.topics} />
          <CountPill label="notes" value={exam.counts.notes} />
          <CountPill label="questions" value={exam.counts.questions} />
          <CountPill label="tests" value={exam.counts.tests} />
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <SyllabusStatusBadge status={exam.syllabusStatus} />
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigateExam(exam.slug)}>
          Explore Exam <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  )
}
