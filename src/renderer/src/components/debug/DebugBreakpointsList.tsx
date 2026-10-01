import React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { useBreakpointStore, type BreakpointSpec } from './breakpoint-store'
import {
  removeDebugBreakpoint,
  setDebugExceptionFilters,
  updateDebugBreakpoint
} from './breakpoint-sync'
import { isInDebugScope, type DebugBreakpointScope } from './debug-breakpoint-scope'
import { revealDebugLocation } from './debug-editor-navigation'
import type { DebugSession } from './debug-store'

function describeSpec(spec: BreakpointSpec): string | null {
  if (spec.logMessage) {
    return translate('debug.breakpoints.logs', 'logs {{value0}}', { value0: spec.logMessage })
  }
  return spec.condition ?? (spec.hitCondition ? `hit ${spec.hitCondition}` : null)
}

function ExceptionFilters({ session }: { session: DebugSession }): React.JSX.Element | null {
  const { adapterId, exceptionFilters: filters } = session
  const chosen = useBreakpointStore((s) => s.exceptionFiltersByAdapter[adapterId])
  if (filters.length === 0) {
    return null
  }
  const active = chosen ?? filters.filter((filter) => filter.default).map((filter) => filter.filter)
  return (
    <div className="border-b border-border px-2 py-1.5" data-testid="debug-exception-filters">
      <div className="pb-1 text-xs text-muted-foreground">
        {translate('debug.breakpoints.exceptions', 'Pause on exceptions')}
      </div>
      {filters.map((filter) => (
        <label key={filter.filter} className="flex items-center gap-2 py-0.5 text-xs">
          <Checkbox
            checked={active.includes(filter.filter)}
            onCheckedChange={(checked) =>
              setDebugExceptionFilters(
                adapterId,
                checked === true
                  ? [...active, filter.filter]
                  : active.filter((id) => id !== filter.filter)
              )
            }
          />
          {filter.label}
        </label>
      ))}
    </div>
  )
}

/**
 * A session's breakpoints (its workspace, its language); with no session, the workspace's.
 * Breakpoints of other workspaces never show, as JetBrains keeps them per project.
 */
export function DebugBreakpointsList({
  session,
  worktreeId: activeWorktreeId
}: {
  session: DebugSession | null
  worktreeId: string | null
}): React.JSX.Element {
  const breakpointsByFile = useBreakpointStore((s) => s.breakpointsByFile)
  const worktreeId = session?.worktreeId ?? activeWorktreeId
  const worktreePath = useAppStore(
    (s) => findWorktreeById(s.worktreesByRepo, worktreeId ?? '')?.path ?? null
  )
  const scope: DebugBreakpointScope | null =
    session ?? (worktreePath ? { rootPath: worktreePath } : null)
  const files = Object.entries(breakpointsByFile)
    .filter(([path]) => scope !== null && isInDebugScope(scope, path))
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="debug-breakpoints">
      {session ? <ExceptionFilters session={session} /> : null}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate(
              'debug.breakpoints.empty',
              'Click left of a line number to add a breakpoint; right-click it for a condition'
            )}
          </div>
        ) : (
          files.flatMap(([path, specs]) =>
            specs.map((spec) => {
              const detail = describeSpec(spec)
              return (
                <div
                  key={`${path}:${spec.line}`}
                  className="group flex items-center gap-2 px-2 py-0.5 text-xs hover:bg-accent"
                >
                  <Checkbox
                    aria-label={translate('debug.breakpoint.enabled', 'Enabled')}
                    checked={spec.enabled}
                    onCheckedChange={(checked) =>
                      updateDebugBreakpoint(path, spec.line, { enabled: checked === true })
                    }
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                    title={path}
                    onClick={() => worktreeId && revealDebugLocation(worktreeId, path, spec.line)}
                  >
                    <span className="truncate">{`${basename(path)}:${spec.line}`}</span>
                    {detail ? (
                      <span className="truncate font-mono text-muted-foreground">{detail}</span>
                    ) : null}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate('debug.breakpoint.remove', 'Remove')}
                    onClick={() => removeDebugBreakpoint(path, spec.line)}
                  >
                    <X />
                  </Button>
                </div>
              )
            })
          )
        )}
      </div>
    </div>
  )
}
