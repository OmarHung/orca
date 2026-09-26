import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import {
  buildDebugpyAdapterSpawn,
  buildDebugpyLaunchArguments,
  resolvePythonInterpreter
} from './debugpy-adapter'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-debugpy-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function makeExecutable(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '#!/bin/sh\n')
  await chmod(path, 0o755)
}

describe('resolvePythonInterpreter', () => {
  it.skipIf(process.platform === 'win32')('prefers the project .venv interpreter', async () => {
    await makeExecutable(join(root, '.venv', 'bin', 'python'))

    await expect(resolvePythonInterpreter(root, 'linux', { PATH: '' })).resolves.toBe(
      join(root, '.venv', 'bin', 'python')
    )
  })

  it.skipIf(process.platform === 'win32')('falls back to python3 on PATH', async () => {
    const binDir = join(root, 'bin')
    await makeExecutable(join(binDir, 'python3'))

    await expect(resolvePythonInterpreter(root, 'linux', { PATH: binDir })).resolves.toBe(
      join(binDir, 'python3')
    )
  })

  it('returns null when no interpreter exists', async () => {
    await expect(resolvePythonInterpreter(root, 'linux', { PATH: '' })).resolves.toBeNull()
  })
})

describe('buildDebugpyAdapterSpawn', () => {
  it('prepends the debugpy directory to an existing PYTHONPATH', () => {
    const spawn = buildDebugpyAdapterSpawn('/usr/bin/python3', '/adapters/debugpy', {
      PYTHONPATH: '/existing'
    })

    expect(spawn.args).toEqual(['-m', 'debugpy.adapter'])
    expect(spawn.env.PYTHONPATH).toBe(`/adapters/debugpy${delimiter}/existing`)
  })

  it('sets PYTHONPATH when none exists', () => {
    const spawn = buildDebugpyAdapterSpawn('/usr/bin/python3', '/adapters/debugpy', {})

    expect(spawn.env.PYTHONPATH).toBe('/adapters/debugpy')
  })
})

describe('buildDebugpyLaunchArguments', () => {
  it('launches the file with the resolved interpreter and routes output to DAP events', () => {
    expect(
      buildDebugpyLaunchArguments({
        filePath: '/p/app.py',
        cwd: '/p',
        pythonPath: '/p/.venv/bin/python'
      })
    ).toMatchObject({
      request: 'launch',
      program: '/p/app.py',
      cwd: '/p',
      python: ['/p/.venv/bin/python'],
      console: 'internalConsole'
    })
  })
})
