/** Where an interpreter was found; also the order auto-detection prefers them in. */
export type PythonInterpreterSource = 'venv' | 'poetry' | 'path' | 'custom'

export type PythonInterpreter = {
  /** Absolute path to the executable. */
  path: string
  source: PythonInterpreterSource
  /** e.g. "3.14.7"; null when the version probe failed. */
  version: string | null
  /** Virtualenv directory name for `venv`, e.g. ".venv". */
  envName?: string
}
