import { toast } from 'sonner'
import { create } from 'zustand'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  DatabaseJobEvent,
  DatabasePickedScripts,
  DatabaseScriptFile,
  DatabaseScriptOptions,
  DatabaseScriptProgress,
  DatabaseScriptSummary
} from '../../../../../shared/database/database-script-types'
import { asDatabaseResult } from '../database-connections-store'
import { useDatabaseExplorerStore } from '../explorer/database-explorer-store'

export type DatabaseJobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export type DatabaseScriptJob = {
  id: string
  connectionId: string
  /** Where it runs, e.g. `prod › sales`. */
  target: string
  files: DatabaseScriptFile[]
  status: DatabaseJobStatus
  progress: DatabaseScriptProgress | null
  summary: DatabaseScriptSummary | null
  error: string | null
  cancelling: boolean
}

/** Where a Run SQL Script dialog was opened from. */
export type DatabaseScriptTarget = {
  connectionId: string
  database: string | null
  schema: string | null
  label: string
}

type DatabaseJobsState = {
  jobs: DatabaseScriptJob[]
  scriptTarget: DatabaseScriptTarget | null
  openRunScript: (target: DatabaseScriptTarget) => void
  closeRunScript: () => void
  runScript: (
    target: DatabaseScriptTarget,
    picked: DatabasePickedScripts,
    options: Pick<DatabaseScriptOptions, 'onError' | 'transaction'>
  ) => Promise<void>
  applyProgress: (event: DatabaseJobEvent) => void
  cancel: (jobId: string) => Promise<void>
  dismiss: (jobId: string) => void
}

function statusOf(summary: DatabaseScriptSummary): DatabaseJobStatus {
  if (summary.cancelled) {
    return 'cancelled'
  }
  return summary.failed > 0 ? 'failed' : 'done'
}

function announce(job: DatabaseScriptJob): void {
  const summary = job.summary
  if (!summary) {
    toast.error(translate('database.jobs.scriptFailed', 'The script could not run'), {
      description: job.error ?? undefined
    })
    return
  }
  const statements = String(summary.statements)
  if (job.status === 'cancelled') {
    toast.info(
      translate('database.jobs.scriptCancelled', 'Script cancelled. Statements run: {{value0}}', {
        value0: statements
      })
    )
  } else if (job.status === 'failed') {
    const first = summary.failures[0]
    toast.error(
      translate('database.jobs.scriptHadErrors', 'Script finished with errors ({{value0}})', {
        value0: String(summary.failed)
      }),
      { description: first ? `${first.file}:${first.line} ${first.message}` : undefined }
    )
  } else {
    toast.success(
      translate('database.jobs.scriptDone', 'Script finished. Statements run: {{value0}}', {
        value0: statements
      })
    )
  }
}

export const useDatabaseJobsStore = create<DatabaseJobsState>((set, get) => {
  const update = (jobId: string, change: Partial<DatabaseScriptJob>): void =>
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === jobId ? { ...job, ...change } : job))
    }))

  return {
    jobs: [],
    scriptTarget: null,
    openRunScript: (target) => set({ scriptTarget: target }),
    closeRunScript: () => set({ scriptTarget: null }),

    runScript: async (target, picked, options) => {
      const id = createBrowserUuid()
      const job: DatabaseScriptJob = {
        id,
        connectionId: target.connectionId,
        target: target.label,
        files: picked.files,
        status: 'running',
        progress: null,
        summary: null,
        error: null,
        cancelling: false
      }
      set((state) => ({ jobs: [job, ...state.jobs] }))
      const result = asDatabaseResult(
        await window.api.database.runScript({
          connectionId: target.connectionId,
          jobId: id,
          token: picked.token,
          options: {
            ...options,
            ...(target.database ? { database: target.database } : {}),
            ...(target.schema ? { schema: target.schema } : {})
          }
        })
      )
      update(
        id,
        result.ok
          ? { status: statusOf(result.value), summary: result.value, cancelling: false }
          : { status: 'failed', error: result.error.message, cancelling: false }
      )
      const finished = get().jobs.find((entry) => entry.id === id)
      if (finished) {
        announce(finished)
      }
      // A script can create or drop anything; what the tree and completion know is stale.
      void useDatabaseExplorerStore.getState().refreshConnection(target.connectionId)
    },

    applyProgress: (event) => {
      if (event.progress.kind === 'script') {
        const { kind: _kind, ...progress } = event.progress
        update(event.jobId, { progress })
      }
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
