import React from 'react'
import { cn } from '@/lib/utils'
import { RUN_MODE_ICONS } from './run-configuration-icon'
import type { RunMode } from './run-mode'

/**
 * A run's mode icon: in the mode's color while live (green run, orange debug, blue build, cyan
 * test, violet publish), muted once finished.
 */
export function RunModeIcon({
  mode,
  tone = 'live',
  className
}: {
  mode: RunMode
  tone?: 'live' | 'finished'
  className?: string
}): React.JSX.Element {
  const Icon = RUN_MODE_ICONS[mode]
  const live = tone === 'live'
  return (
    <Icon
      aria-hidden
      data-run-mode={mode}
      className={cn(
        'shrink-0',
        live && mode === 'run' && 'text-status-success',
        live && mode === 'debug' && 'text-run-mode-debug',
        live && mode === 'build' && 'text-run-mode-build',
        live && mode === 'test' && 'text-run-mode-test',
        live && mode === 'publish' && 'text-run-mode-publish',
        tone === 'finished' && 'text-muted-foreground',
        className
      )}
    />
  )
}
