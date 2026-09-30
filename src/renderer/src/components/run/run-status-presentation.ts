import { translate } from '@/i18n/i18n'
import type { RunSession } from './run-session-store'

export type RunStatusTone = 'idle' | 'running' | 'success' | 'failure'

export function runStatusTone(session: RunSession | null): RunStatusTone {
  if (!session) {
    return 'idle'
  }
  switch (session.status) {
    case 'queued':
    case 'running':
    case 'stopping':
    case 'unverifiable':
      return 'running'
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'failure'
    case 'finished':
    case 'stopped':
      return 'idle'
  }
}

export function describeRunStatus(session: RunSession | null): string | null {
  if (!session) {
    return null
  }
  switch (session.status) {
    case 'queued':
      return translate('run.status.queued', 'Starting…')
    case 'running':
      return translate('run.status.running', 'Running')
    case 'stopping':
      return translate('run.status.stopping', 'Stopping…')
    case 'unverifiable':
      return translate('run.status.unverifiable', 'Terminal unavailable')
    case 'succeeded':
    case 'finished':
      return translate('run.status.succeeded', 'Finished')
    case 'failed':
      return translate('run.status.failed', 'Failed (exit {{value0}})', {
        value0: String(session.exitCode ?? '?')
      })
    case 'stopped':
      return translate('run.status.stopped', 'Stopped')
  }
}
