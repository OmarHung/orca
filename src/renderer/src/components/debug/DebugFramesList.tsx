import React from 'react'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { cn } from '@/lib/utils'
import { selectDebugFrame } from './debug-session-controller'
import type { DebugSession } from './debug-store'

export function DebugFramesList({ session }: { session: DebugSession | null }): React.JSX.Element {
  const frames = session?.frames ?? []
  const selectedFrameId = session?.selectedFrameId ?? null

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="debug-frames">
      <div className="shrink-0 px-2 py-1 text-xs font-semibold text-muted-foreground">
        {translate('debug.frames', 'Frames')}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
        {!session || frames.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate('debug.framesEmpty', 'Frames appear when the program pauses')}
          </div>
        ) : (
          frames.map((frame) => (
            <button
              key={frame.id}
              type="button"
              className={cn(
                'flex w-full min-w-0 items-baseline gap-2 px-2 py-0.5 text-left text-xs hover:bg-accent',
                frame.id === selectedFrameId && 'bg-accent text-accent-foreground'
              )}
              onClick={() => void selectDebugFrame(session.id, frame.id)}
            >
              <span className="truncate font-medium">{frame.name}</span>
              <span className="truncate text-muted-foreground">
                {frame.source?.path ? `${basename(frame.source.path)}:${frame.line}` : frame.line}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
