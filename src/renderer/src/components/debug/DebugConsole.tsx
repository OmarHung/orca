import React, { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useDebugStore } from './debug-store'
import { DebugConsoleInput } from './DebugConsoleInput'

export function DebugConsole(): React.JSX.Element {
  const output = useDebugStore((s) => s.output)
  const lastError = useDebugStore((s) => s.lastError)
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
      <DebugConsoleInput />
    </div>
  )
}
