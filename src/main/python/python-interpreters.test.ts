import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectPythonInterpreters,
  resolvePythonInterpreter,
  type InterpreterDetectionDeps
} from './python-interpreters'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-python-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function makeExecutable(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '#!/bin/sh\n')
  await chmod(path, 0o755)
}

function deps(
  pathDir: string,
  probe: InterpreterDetectionDeps['probe'] = async () => 'Python 3.12.4'
): InterpreterDetectionDeps {
  return { platform: 'linux', env: { PATH: pathDir }, probe }
}

describe.skipIf(process.platform === 'win32')('detectPythonInterpreters', () => {
  it('lists project virtualenvs before Python on PATH, with versions', async () => {
    await makeExecutable(join(root, '.venv', 'bin', 'python'))
    await makeExecutable(join(root, 'bin', 'python3'))

    const found = await detectPythonInterpreters(root, deps(join(root, 'bin')))

    expect(found).toEqual([
      {
        path: join(root, '.venv', 'bin', 'python'),
        source: 'venv',
        envName: '.venv',
        version: '3.12.4'
      },
      { path: join(root, 'bin', 'python3'), source: 'path', version: '3.12.4' }
    ])
  })

  it('lists python and python3 once when they are the same binary', async () => {
    const bin = join(root, 'bin')
    await makeExecutable(join(bin, 'python3'))
    const { symlink } = await import('node:fs/promises')
    await symlink(join(bin, 'python3'), join(bin, 'python'))

    const found = await detectPythonInterpreters(root, deps(bin))

    expect(found.map((interpreter) => interpreter.path)).toEqual([join(bin, 'python3')])
  })

  it('keeps a venv separate from the PATH Python its executable links to', async () => {
    const bin = join(root, 'bin')
    await makeExecutable(join(bin, 'python3'))
    await mkdir(join(root, '.venv', 'bin'), { recursive: true })
    const { symlink } = await import('node:fs/promises')
    await symlink(join(bin, 'python3'), join(root, '.venv', 'bin', 'python'))

    const found = await detectPythonInterpreters(root, deps(bin))

    expect(found.map((interpreter) => interpreter.source)).toEqual(['venv', 'path'])
  })

  it('reports a null version when the probe fails', async () => {
    await makeExecutable(join(root, 'venv', 'bin', 'python'))

    const found = await detectPythonInterpreters(
      root,
      deps('', async () => null)
    )

    expect(found).toEqual([
      { path: join(root, 'venv', 'bin', 'python'), source: 'venv', envName: 'venv', version: null }
    ])
  })

  it("adds poetry's environment when the project has a poetry.lock", async () => {
    const bin = join(root, 'bin')
    const poetryEnv = join(root, 'poetry-env')
    await makeExecutable(join(bin, 'poetry'))
    await makeExecutable(join(poetryEnv, 'bin', 'python'))
    await writeFile(join(root, 'poetry.lock'), '')
    const probe = vi.fn(async (program: string) =>
      program.endsWith('poetry') ? `${poetryEnv}\n` : 'Python 3.11.9'
    )

    const found = await detectPythonInterpreters(root, deps(bin, probe))

    expect(found[0]).toEqual({
      path: join(poetryEnv, 'bin', 'python'),
      source: 'poetry',
      version: '3.11.9'
    })
  })

  it('skips poetry when there is no poetry.lock', async () => {
    const bin = join(root, 'bin')
    await makeExecutable(join(bin, 'poetry'))
    const probe = vi.fn(async () => 'Python 3.11.9')

    await detectPythonInterpreters(root, deps(bin, probe))

    expect(probe).not.toHaveBeenCalledWith(
      expect.stringContaining('poetry'),
      expect.anything(),
      root
    )
  })
})

describe('resolvePythonInterpreter', () => {
  it.skipIf(process.platform === 'win32')('prefers the project .venv', async () => {
    await makeExecutable(join(root, '.venv', 'bin', 'python'))

    await expect(resolvePythonInterpreter(root, deps(''))).resolves.toBe(
      join(root, '.venv', 'bin', 'python')
    )
  })

  it('returns null when no interpreter exists', async () => {
    await expect(resolvePythonInterpreter(root, deps(''))).resolves.toBeNull()
  })
})
