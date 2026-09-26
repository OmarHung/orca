import React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import { useBreakpointStore, type BreakpointSpec } from './breakpoint-store'
import {
  removeDebugBreakpoint,
  setDebugExceptionFilters,
  updateDebugBreakpoint
} from './breakpoint-sync'
import { revealDebugLocation } from './debug-editor-navigation'
import { useDebugStore } from './debug-store'

function describeSpec(spec: BreakpointSpec): string | null {
  if (spec.logMessage) {
    return translate('debug.breakpoints.logs', 'logs {{value0}}', { value0: spec.logMessage })
  }
  return spec.condition ?? (spec.hitCondition ? `hit ${spec.hitCondition}` : null)
}

function ExceptionFilters(): React.JSX.Element | null {
  const options = useDebugStore((s) => s.exceptionFilterOptions)
  const chosen = useBreakpointStore((s) =>
    options ? s.exceptionFiltersByAdapter[options.adapterId] : undefined
  )
  if (!options || options.filters.length === 0) {
    return null
  }
  const active =
    chosen ?? options.filters.filter((filter) => filter.default).map((filter) => filter.filter)
  return (
    <div className="border-b border-border px-2 py-1.5" data-testid="debug-exception-filters">
      <div className="pb-1 text-xs text-muted-foreground">
        {translate('debug.breakpoints.exceptions', 'Pause on exceptions')}
      </div>
      {options.filters.map((filter) => (
        <label key={filter.filter} className="flex items-center gap-2 py-0.5 text-xs">
          <Checkbox
            checked={active.includes(filter.filter)}
            onCheckedChange={(checked) =>
              setDebugExceptionFilters(
                options.adapterId,
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

export function DebugBreakpointsList(): React.JSX.Element {
  const breakpointsByFile = useBreakpointStore((s) => s.breakpointsByFile)
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const files = Object.entries(breakpointsByFile).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="debug-breakpoints">
      <ExceptionFilters />
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
