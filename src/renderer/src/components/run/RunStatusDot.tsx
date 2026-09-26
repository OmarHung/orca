import React from 'react'
import { cn } from '@/lib/utils'
import type { RunStatusTone } from './run-status-presentation'

export function RunStatusDot({ tone }: { tone: RunStatusTone }): React.JSX.Element | null {
  if (tone === 'idle') {
    return null
  }
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        tone === 'running' && 'animate-pulse bg-status-success',
        tone === 'success' && 'bg-status-success',
        tone === 'failure' && 'bg-destructive'
      )}
    />
  )
}
