import { create } from 'zustand'
import type { SshCommand, SshCommandDraft } from '../../../../shared/ssh-command-types'

type SshCommandsState = {
  commands: readonly SshCommand[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  load: () => Promise<void>
  /** Throws with the reason, so the form stays open with what was typed. */
  save: (id: string | undefined, draft: SshCommandDraft) => Promise<SshCommand>
  remove: (id: string) => Promise<void>
}

/** The saved commands. Main owns the file; this mirrors it for the page. */
export const useSshCommandsStore = create<SshCommandsState>((set, get) => ({
  commands: [],
  status: 'idle',
  error: null,
  load: async () => {
    set({ status: 'loading', error: null })
    const result = await window.api.sshCommands.list().catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err)
    }))
    set(
      result.ok
        ? { commands: result.value, status: 'ready', error: null }
        : { status: 'error', error: result.error }
    )
  },
  save: async (id, draft) => {
    const result = await window.api.sshCommands.save({ id, draft })
    if (!result.ok) {
      throw new Error(result.error)
    }
    const { commands } = get()
    const exists = commands.some((command) => command.id === result.value.id)
    set({
      commands: exists
        ? commands.map((command) => (command.id === result.value.id ? result.value : command))
        : [...commands, result.value]
    })
    return result.value
  },
  remove: async (id) => {
    const result = await window.api.sshCommands.delete(id)
    if (!result.ok) {
      throw new Error(result.error)
    }
    set({ commands: get().commands.filter((command) => command.id !== id) })
  }
}))
