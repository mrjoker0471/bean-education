'use client'

// Reusable building blocks for the ExamView detail page (Task 4-a).

import type {
  ResourceDTO,
  StagePatternDTO,
  SubjectNode,
  TestTemplateDTO,
  TopicNode,
} from '@/lib/types'
import { useAppStore } from '@/lib/store'
import { CountPill } from '@/components/bean/count-pill'
import { AccessTypeBadge, ResourceStatusBadge } from '@/components/bean/status-badge'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Loader2,
  MinusCircle,
  Play,
} from 'lucide-react'

/** Honest negative-marking copy: "−0.25 per wrong answer" or "No negative marking". */
export function negativeMarkText(negativeMark: number): string {
  return negativeMark > 0
    ? `\u2212${negativeMark} per wrong answer`
    : 'No negative marking'
}

function NegativeMarkBadge({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        value > 0
          ? 'border-gold/40 bg-gold/10 text-gold'
          : 'border-success/40 bg-success/10 text-success'
      )}
    >
      {value > 0 ? <MinusCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {negativeMarkText(value)}
    </span>
  )
}

// ─── Stage marking-pattern table ───
export function PatternTable({ pattern }: { pattern: StagePatternDTO }) {
  const hasSections = pattern.sections.length > 0
  return (
    <div>
      {hasSections && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-elevated hover:bg-elevated">
                  <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Section</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">Questions</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide text-muted-foreground">Marks</TableHead>
                  <TableHead className="hidden text-right text-xs uppercase tracking-wide text-muted-foreground sm:table-cell">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pattern.sections.map(section => (
                  <TableRow key={section.name} className="border-border">
                    <TableCell className="text-sm text-foreground">{section.name}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{section.questions}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{section.marks}</TableCell>
                    <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                      {section.durationMin ? `${section.durationMin} min` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-border bg-card/70">
                  <TableCell className="text-sm font-semibold text-foreground">Total</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-gold">{pattern.totalQuestions}</TableCell>
                  <TableCell className="text-right text-sm font-semibold text-gold">{pattern.totalMarks}</TableCell>
                  <TableCell className="hidden text-right text-sm font-semibold text-gold sm:table-cell">{pattern.durationMin} min</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-muted-foreground">
          Duration: {pattern.durationMin} minutes
        </span>
        <NegativeMarkBadge value={pattern.negativeMark} />
        {pattern.qualifying && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-muted-foreground">
            {pattern.qualifying}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Exam-level resource list ───
export function ResourceList({ resources }: { resources: ResourceDTO[] }) {
  return (
    <ul className="space-y-2">
      {resources.map(resource => (
        <li
          key={resource.id}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug text-foreground">{resource.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {resource.provider}
              {resource.language ? ` · ${resource.language}` : ''}
              {resource.note ? ` · ${resource.note}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <ResourceStatusBadge status={resource.verificationStatus} />
              <AccessTypeBadge access={resource.accessType} />
            </div>
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="shrink-0 self-start border-gold/40 text-gold hover:bg-gold/10 sm:self-center"
          >
            <a href={resource.url} target="_blank" rel="noopener noreferrer" aria-label={`Open resource: ${resource.title}`}>
              Open <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </li>
      ))}
    </ul>
  )
}

// ─── Syllabus topic row ───
export function TopicRow({
  topic,
  pending,
  onStart,
}: {
  topic: TopicNode
  pending: boolean
  onStart: () => void
}) {
  const navigate = useAppStore(s => s.navigate)
  return (
    <li className="flex flex-col gap-2.5 rounded-lg border border-transparent px-2 py-2.5 transition-colors hover:border-border hover:bg-elevated sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => navigate({ view: 'topic', topicId: topic.id })}
          className="text-left text-sm font-medium text-foreground transition-colors hover:text-gold"
          aria-label={`Open topic ${topic.name}`}
        >
          {topic.name}
        </button>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {topic.noteAvailable && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold"
              title="Original BEAN EXAMS study note available"
            >
              <BookOpen className="h-3 w-3" /> Note
            </span>
          )}
          {topic.questionCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
              <HelpCircle className="h-3 w-3 text-gold" /> {topic.questionCount} {topic.questionCount === 1 ? 'question' : 'questions'}
            </span>
          ) : (
            <span className="text-[11px] italic text-muted-foreground">material in progress</span>
          )}
          {topic.resourceCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] text-muted-foreground">
              <ExternalLink className="h-3 w-3 text-gold" /> {topic.resourceCount} {topic.resourceCount === 1 ? 'resource' : 'resources'}
            </span>
          )}
        </div>
      </div>
      {topic.questionCount >= 4 && (
        <Button
          size="sm"
          disabled={pending}
          onClick={onStart}
          className="shrink-0 self-start bg-gold text-primary-foreground hover:bg-gold-hover sm:self-center"
        >
          {pending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Practice
        </Button>
      )}
    </li>
  )
}

// ─── Subject card with units accordion (Syllabus tab) ───
export function SubjectSyllabusCard({
  subject,
  pendingTopicId,
  onStartTopic,
}: {
  subject: SubjectNode
  pendingTopicId: string | null
  onStartTopic: (topic: TopicNode) => void
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-display text-base font-semibold text-foreground">{subject.name}</h4>
            {subject.description && (
              <p className="mt-1 line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{subject.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CountPill label="topics" value={subject.topicCount} />
            <CountPill label="notes" value={subject.noteCount} />
            <CountPill label="questions" value={subject.questionCount} />
          </div>
        </div>

        {subject.units.length > 0 ? (
          <Accordion
            type="single"
            collapsible
            className="mt-4"
            defaultValue={subject.units[0]?.id}
          >
            {subject.units.map(unit => (
              <AccordionItem key={unit.id} value={unit.id} className="border-border last:border-b">
                <AccordionTrigger className="rounded-lg px-3 py-3 text-left hover:bg-elevated hover:no-underline">
                  <span className="flex w-full items-center justify-between gap-2 pr-2">
                    <span className="text-sm font-medium text-foreground">{unit.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {unit.topics.length} {unit.topics.length === 1 ? 'topic' : 'topics'}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <ul className="max-h-96 space-y-0.5 overflow-y-auto pr-1">
                    {unit.topics.map(topic => (
                      <TopicRow
                        key={topic.id}
                        topic={topic}
                        pending={pendingTopicId === topic.id}
                        onStart={() => onStartTopic(topic)}
                      />
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs text-muted-foreground">
            Units for this subject are being mapped — check back soon.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Practice-test template card (Tests tab) ───
export function TemplateCard({
  template,
  pending,
  error,
  onStart,
}: {
  template: TestTemplateDTO
  pending: boolean
  error: string | null
  onStart: () => void
}) {
  return (
    <Card className="flex h-full flex-col border-border bg-card">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="font-display text-base font-semibold leading-snug text-foreground">{template.title}</h4>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{template.description}</p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0',
              template.type === 'MIXED'
                ? 'border-gold/40 bg-gold/10 text-gold'
                : 'border-border text-muted-foreground'
            )}
          >
            {template.type === 'MIXED' ? 'Mixed mock' : 'Subject test'}
          </Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <CountPill label="questions" value={template.config.count} />
          <CountPill label="min" value={template.config.durationMin} />
          <NegativeMarkBadge value={template.config.negativeMark} />
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          disabled={pending}
          onClick={onStart}
          className="mt-4 w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto sm:self-start"
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="mr-2 h-4 w-4" aria-hidden />
          )}
          Start test
        </Button>
      </CardContent>
    </Card>
  )
}
