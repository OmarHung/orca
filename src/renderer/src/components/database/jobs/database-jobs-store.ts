import { toast } from 'sonner'
import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  DatabaseDumpDestination,
  DatabaseDumpProgress,
  DatabaseDumpRequest,
  DatabaseDumpSummary,
  DatabaseJobEvent
} from '../../../../../shared/database/database-dump-types'
import { asDatabaseResult } from '../database-connections-store'

export type DatabaseJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export type DatabaseDumpJob = {
  id: string
  connectionId: string
  /** What it reads, e.g. `prod › sales`. */
  source: string
  /** The file or folder it writes. */
  destination: string
  dataOnly: boolean
  /** The native tool that writes it (e.g. pg_dump); null for Orca's own dump. */
  tool: string | null
  status: DatabaseJobStatus
  progress: DatabaseDumpProgress | null
  summary: DatabaseDumpSummary | null
  error: string | null
  cancelling: boolean
}

/** Where a dump dialog was opened from, and which of its two menu items opened it. */
export type DatabaseDumpScope = {
  connectionId: string
  /** Null is the connection's own database. */
  database: string | null
  /** Null lists every schema of the database. */
  schema: string | null
  /** The one object to check at first; null checks everything listed. */
  only: { schema: string; name: string } | null
  dataOnly: boolean
  label: string
}

export type DatabaseDumpStart = {
  connectionId: string
  source: string
  tool: string | null
  destination: DatabaseDumpDestination
  request: DatabaseDumpRequest
}

type DatabaseJobsState = {
  jobs: DatabaseDumpJob[]
  dumpScope: DatabaseDumpScope | null
  openDump: (scope: DatabaseDumpScope) => void
  closeDump: () => void
  startDump: (start: DatabaseDumpStart) => Promise<void>
  applyProgress: (event: DatabaseJobEvent) => void
  cancel: (jobId: string) => Promise<void>
  dismiss: (jobId: string) => void
}

function announce(job: DatabaseDumpJob): void {
  switch (job.status) {
    case 'running':
      return
    case 'failed':
      toast.error(translate('database.jobs.dumpFailed', 'The dump failed'), {
        description: job.error ?? undefined
      })
      return
    case 'cancelled':
      toast.info(translate('database.jobs.dumpCancelled', 'Dump cancelled; nothing was saved'))
      return
    case 'done':
      toast.success(translate('database.jobs.dumpDone', 'Dump saved'), {
        description: job.destination,
        action: {
          label: translate('database.jobs.showInFolder', 'Show in Folder'),
          onClick: () => void window.api.shell.openInFileManager(job.destination)
        }
      })
  }
}

export const useDatabaseJobsStore = create<DatabaseJobsState>((set, get) => {
  const update = (jobId: string, change: Partial<DatabaseDumpJob>): void =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === jobId ? { ...job, ...change } : job))
    }))

  return {
    jobs: [],
    dumpScope: null,
    openDump: (scope) => set({ dumpScope: scope }),
    closeDump: () => set({ dumpScope: null }),

    startDump: async ({ connectionId, source, tool, destination, request }) => {
      const id = createBrowserUuid()
      const job: DatabaseDumpJob = {
        id,
        connectionId,
        source,
        destination: destination.label,
        dataOnly: request.options.contents === 'data',
        tool,
        status: 'running',
        progress: null,
        summary: null,
        error: null,
        cancelling: false
      }
      set((state) => ({ jobs: [job, ...state.jobs] }))
      const result = asDatabaseResult(
        await window.api.database.dump({
          connectionId,
          jobId: id,
          token: destination.token,
          dump: request
        })
      )
      update(
        id,
        result.ok
          ? {
              status: result.value.cancelled ? 'cancelled' : 'done',
              summary: result.value,
              cancelling: false
            }
          : { status: 'failed', error: result.error.message, cancelling: false }
      )
      const finished = get().jobs.find((entry) => entry.id === id)
      if (finished) {
        announce(finished)
      }
    },

    applyProgress: (event) => {
      const { kind: _kind, ...progress } = event.progress
      update(event.jobId, { progress })
    },

    cancel: async (jobId) => {
      const job = get().jobs.find((entry) => entry.id === jobId)
      if (!job || job.status !== 'running') {
        return
      }
      update(jobId, { cancelling: true })
      await window.api.database.cancelJob({ connectionId: job.connectionId, jobId })
    },

    dismiss: (jobId) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== jobId) }))
  }
})
