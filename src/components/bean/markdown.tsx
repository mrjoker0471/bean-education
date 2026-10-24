'use client'

import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('note-markdown', className)}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
