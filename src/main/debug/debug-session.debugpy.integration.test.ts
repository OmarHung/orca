import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import {
  buildDebugpyAdapterSpawn,
  buildDebugpyLaunchArguments,
  resolvePythonInterpreter
} from './adapters/debugpy-adapter'
import { startStdioDapTransport } from './dap-transport-stdio'
import { startDebugSession } from './debug-session'

// Opt-in: point at an extracted debugpy wheel, e.g. `python3 -m zipfile -e debugpy-*.whl <dir>`.
const debugpyDir = process.env.ORCA_TEST_DEBUGPY_DIR

type Body = Record<string, unknown>

function field<T>(body: unknown, key: string): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test reads known debugpy response shapes.
  return (body as Body)[key] as T
}

describe.skipIf(!debugpyDir)('debug session against real debugpy', () => {
  it('stops at a breakpoint and exposes local variables', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'orca-debugpy-it-'))
    const program = join(workdir, 'app.py')
    await writeFile(program, 'answer = 41\nanswer += 1\nprint(answer)\n')
    const python = await resolvePythonInterpreter(workdir)
    expect(python).not.toBeNull()
    const spawn = buildDebugpyAdapterSpawn(python!, debugpyDir!)
    const events: DebugSessionEvent[] = []

    const session = startDebugSession({
      id: 'it',
      adapterId: 'debugpy',
      transport: startStdioDapTransport({ ...spawn, cwd: workdir }),
      launchArguments: buildDebugpyLaunchArguments({
        filePath: program,
        cwd: workdir,
        pythonPath: python!
      }),
      breakpoints: { [program]: [{ line: 2 }] },
      emit: (event) => events.push(event)
    })

    try {
      await session.ready
      await vi.waitFor(
        () =>
          expect(events).toContainEqual(
            expect.objectContaining({ event: expect.objectContaining({ event: 'stopped' }) })
          ),
        { timeout: 20_000 }
      )
      const threads = field<{ id: number }[]>(await session.request('threads', {}), 'threads')
      const frames = field<{ id: number; line: number }[]>(
        await session.request('stackTrace', { threadId: threads[0].id }),
        'stackFrames'
      )
      expect(frames[0].line).toBe(2)
      const scopes = field<{ variablesReference: number }[]>(
        await session.request('scopes', { frameId: frames[0].id }),
        'scopes'
      )
      const variables = field<{ name: string; value: string }[]>(
        await session.request('variables', { variablesReference: scopes[0].variablesReference }),
        'variables'
      )
      expect(variables).toContainEqual(expect.objectContaining({ name: 'answer', value: '41' }))

      await session.request('continue', { threadId: threads[0].id })
      await vi.waitFor(
        () => expect(events).toContainEqual({ kind: 'phase', sessionId: 'it', phase: 'ended' }),
        { timeout: 20_000 }
      )
      const output = events
        .flatMap((event) =>
          event.kind === 'dap-event' && event.event.event === 'output'
            ? [event.event.body?.output]
            : []
        )
        .join('')
      expect(output).toContain('42')
    } finally {
      await session.stop()
      await rm(workdir, { recursive: true, force: true })
    }
  }, 60_000)
})
