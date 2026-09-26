import { create } from 'zustand'
import type { PythonInterpreter } from '../../../../shared/python-interpreter-types'
import { basename } from '@/lib/path'

const CHOICE_STORAGE_KEY = 'orca.python.interpreterByProject.v1'

/** Per-project choice; `auto` follows detection (project venv first). */
export type PythonInterpreterChoice =
  | { mode: 'auto' }
  | { mode: 'fixed'; interpreter: PythonInterpreter }

export type DetectedInterpreters = {
  status: 'loading' | 'ready'
  interpreters: PythonInterpreter[]
}

const AUTO: PythonInterpreterChoice = { mode: 'auto' }

export function resolveEffectiveInterpreter(
  choice: PythonInterpreterChoice,
  detected: readonly PythonInterpreter[]
): PythonInterpreter | null {
  return choice.mode === 'fixed' ? choice.interpreter : (detected[0] ?? null)
}

/** e.g. "Python 3.14 (.venv)" or "Python 3.12 (python3)". */
export function interpreterLabel(interpreter: PythonInterpreter): string {
  const version = interpreter.version?.split('.').slice(0, 2).join('.')
  const name = version ? `Python ${version}` : 'Python'
  const where =
    interpreter.source === 'venv'
      ? interpreter.envName
      : interpreter.source === 'poetry'
        ? 'poetry'
        : basename(interpreter.path)
  return where ? `${name} (${where})` : name
}

function isInterpreter(value: unknown): value is PythonInterpreter {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record: Record<string, unknown> = { ...value }
  return (
    typeof record.path === 'string' &&
    (record.version === null || typeof record.version === 'string') &&
    (record.source === 'venv' ||
      record.source === 'poetry' ||
      record.source === 'path' ||
      record.source === 'custom')
  )
}

function readChoices(): Record<string, PythonInterpreterChoice> {
  try {
    const raw = window.localStorage.getItem(CHOICE_STORAGE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    if (typeof value !== 'object' || value === null) {
      return {}
    }
    const choices: Record<string, PythonInterpreterChoice> = {}
    for (const [projectId, interpreter] of Object.entries(value)) {
      if (isInterpreter(interpreter)) {
        choices[projectId] = { mode: 'fixed', interpreter }
      }
    }
    return choices
  } catch {
    return {}
  }
}

function writeChoices(choices: Record<string, PythonInterpreterChoice>): void {
  const fixed: Record<string, PythonInterpreter> = {}
  for (const [projectId, choice] of Object.entries(choices)) {
    if (choice.mode === 'fixed') {
      fixed[projectId] = choice.interpreter
    }
  }
  try {
    window.localStorage.setItem(CHOICE_STORAGE_KEY, JSON.stringify(fixed))
  } catch {
    // Storage can be unavailable; the choice then lasts only for this window.
  }
}

type PythonInterpreterState = {
  choiceByProject: Record<string, PythonInterpreterChoice>
  detectedByRoot: Record<string, DetectedInterpreters>
  choiceFor: (projectId: string) => PythonInterpreterChoice
  setChoice: (projectId: string, choice: PythonInterpreterChoice) => void
  /** Detects interpreters for a local project root; `force` re-runs a finished detection. */
  detect: (root: string, force?: boolean) => Promise<void>
}

// Why localStorage, not synced settings: interpreter paths only exist on this machine,
// and the shared quick command shape must stay unchanged for mobile/older clients.
export const usePythonInterpreterStore = create<PythonInterpreterState>((set, get) => ({
  choiceByProject: readChoices(),
  detectedByRoot: {},
  choiceFor: (projectId) => get().choiceByProject[projectId] ?? AUTO,
  setChoice: (projectId, choice) => {
    const choiceByProject = { ...get().choiceByProject, [projectId]: choice }
    set({ choiceByProject })
    writeChoices(choiceByProject)
  },
  detect: async (root, force = false) => {
    const current = get().detectedByRoot[root]
    if (current?.status === 'loading' || (current && !force)) {
      return
    }
    set({
      detectedByRoot: {
        ...get().detectedByRoot,
        [root]: { status: 'loading', interpreters: current?.interpreters ?? [] }
      }
    })
    const interpreters = await window.api.python.detectInterpreters(root).catch(() => [])
    set({
      detectedByRoot: { ...get().detectedByRoot, [root]: { status: 'ready', interpreters } }
    })
  }
}))
