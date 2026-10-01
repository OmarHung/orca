import React, { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { debugOutput, useDebugStore, type DebugSession } from './debug-store'
import { DebugConsoleInput } from './DebugConsoleInput'

const NO_OUTPUT: ReturnType<typeof debugOutput> = []

export function DebugConsole({ session }: { session: DebugSession | null }): React.JSX.Element {
  const output = useDebugStore((s) => (session ? debugOutput(s, session.id) : NO_OUTPUT))
  const lastError = session?.lastError ?? null
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Why: keep following new output like a terminal.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [output, lastError])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="debug-console">
      <div
        ref={scrollRef}
        className="scrollbar-sleek min-h-0 flex-1 overflow-auto px-2 font-mono text-xs whitespace-pre-wrap select-text"
      >
        {output.map((entry) => (
          <span
            key={entry.id}
            className={cn(
              entry.category === 'stderr' && 'text-destructive',
              (entry.category === 'console' || entry.category === 'orca') && 'text-muted-foreground'
            )}
          >
            {entry.text}
          </span>
        ))}
        {lastError ? <div className="text-destructive">{lastError}</div> : null}
      </div>
      <DebugConsoleInput session={session} />
    </div>
  )
}
