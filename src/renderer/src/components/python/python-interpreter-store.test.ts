// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PythonInterpreter } from '../../../../shared/python-interpreter-types'
import {
  interpreterLabel,
  resolveEffectiveInterpreter,
  usePythonInterpreterStore
} from './python-interpreter-store'

const venv: PythonInterpreter = {
  path: '/p/.venv/bin/python',
  source: 'venv',
  envName: '.venv',
  version: '3.14.7'
}
const system: PythonInterpreter = { path: '/usr/bin/python3', source: 'path', version: '3.12.1' }

const detectInterpreters = vi.fn(async () => [venv, system])

beforeEach(() => {
  window.localStorage.clear()
  detectInterpreters.mockClear()
  Object.assign(window, { api: { python: { detectInterpreters } } })
  usePythonInterpreterStore.setState({ choiceByProject: {}, detectedByRoot: {} })
})

describe('resolveEffectiveInterpreter', () => {
  it('uses the first detected interpreter in auto mode', () => {
    expect(resolveEffectiveInterpreter({ mode: 'auto' }, [venv, system])).toBe(venv)
    expect(resolveEffectiveInterpreter({ mode: 'auto' }, [])).toBeNull()
  })

  it('uses the fixed interpreter even when detection found others', () => {
    expect(resolveEffectiveInterpreter({ mode: 'fixed', interpreter: system }, [venv])).toBe(system)
  })
})

describe('interpreterLabel', () => {
  it('names the version and where the interpreter comes from', () => {
    expect(interpreterLabel(venv)).toBe('Python 3.14 (.venv)')
    expect(interpreterLabel(system)).toBe('Python 3.12 (python3)')
    expect(
      interpreterLabel({ path: '/x/poetry/bin/python', source: 'poetry', version: null })
    ).toBe('Python (poetry)')
  })
})

describe('usePythonInterpreterStore', () => {
  it('persists a fixed choice per project and restores auto when cleared', () => {
    usePythonInterpreterStore.getState().setChoice('repo-1', { mode: 'fixed', interpreter: system })

    expect(
      JSON.parse(window.localStorage.getItem('orca.python.interpreterByProject.v1') ?? '')
    ).toEqual({ 'repo-1': system })
    expect(usePythonInterpreterStore.getState().choiceFor('repo-2')).toEqual({ mode: 'auto' })

    usePythonInterpreterStore.getState().setChoice('repo-1', { mode: 'auto' })
    expect(window.localStorage.getItem('orca.python.interpreterByProject.v1')).toBe('{}')
  })

  it('detects once per project root unless forced', async () => {
    await usePythonInterpreterStore.getState().detect('/p')
    await usePythonInterpreterStore.getState().detect('/p')

    expect(detectInterpreters).toHaveBeenCalledTimes(1)
    expect(usePythonInterpreterStore.getState().detectedByRoot['/p']).toEqual({
      status: 'ready',
      interpreters: [venv, system]
    })

    await usePythonInterpreterStore.getState().detect('/p', true)
    expect(detectInterpreters).toHaveBeenCalledTimes(2)
  })
})
