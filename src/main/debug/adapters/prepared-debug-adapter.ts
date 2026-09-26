import type { DapTransport } from '../dap-transport'

/** A debug adapter ready for a session: how to talk to it and what to ask it to launch. */
export type PreparedDebugAdapter = {
  adapterId: string
  transport: DapTransport
  openChildTransport?: () => Promise<DapTransport>
  launchArguments: Record<string, unknown>
  /** Recent adapter stderr, for error messages when the launch fails. */
  diagnostics: () => string
  /** Releases helpers that outlive the connection, e.g. js-debug's server process. */
  dispose: () => void
}

export type AdapterPreparation = {
  adaptersDir: string
  cwd: string
  /** Called before a first-use download, so the UI can say what it is waiting for. */
  onInstalling: () => void
  /** Streams preparation output (e.g. a build) to the Debug console. */
  onOutput: (text: string, category: 'stdout' | 'stderr' | 'console') => void
}

export class DebugPreparationError extends Error {}
