import { createContext, useContext } from 'react'

// Keep the context component-free so Fast Refresh preserves its identity.

export type CommandConfirmOptions = {
  title: string
  /** Short lines above the commands, e.g. the host and what the action touches. */
  details?: readonly string[]
  /** Shown highlighted, e.g. items that will be replaced. */
  warnings?: readonly string[]
  /** Exactly what will run, one command per line, in order. */
  commands: readonly string[]
  /** How to read the commands, shown under them. */
  notes?: readonly string[]
  confirmLabel: string
  isDestructive?: boolean
}

export type CommandConfirm = (options: CommandConfirmOptions) => Promise<boolean>

export const CommandConfirmContext = createContext<CommandConfirm | null>(null)

export function useCommandConfirm(): CommandConfirm {
  const confirm = useContext(CommandConfirmContext)
  if (!confirm) {
    throw new Error('useCommandConfirm must be used inside CommandConfirmProvider')
  }
  return confirm
}
