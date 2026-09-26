import { delimiter } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { buildDebugpyAdapterSpawn, buildDebugpyLaunchArguments } from './debugpy-adapter'

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
