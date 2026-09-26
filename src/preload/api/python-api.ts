import type { PythonInterpreter } from '../../shared/python-interpreter-types'

export type PythonApi = {
  /** Interpreters for the local project at `projectRoot`, preferred first. */
  detectInterpreters: (projectRoot: string) => Promise<PythonInterpreter[]>
  /** Opens a file picker; null when cancelled or the file is not executable. */
  pickInterpreter: (projectRoot: string) => Promise<PythonInterpreter | null>
}
