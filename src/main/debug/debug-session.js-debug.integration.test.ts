import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import { buildNodeLaunchArguments, startJsDebugServer } from './adapters/js-debug-adapter'
import { connectTcpDapTransport } from './dap-transport-tcp'
import { startDebugSession } from './debug-session'

// Opt-in: point at an extracted js-debug-dap release (the folder containing `js-debug/`).
const jsDebugDir = process.env.ORCA_TEST_JSDEBUG_DIR

type Body = Record<string, unknown>

function field<T>(body: unknown, key: string): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test reads known js-debug response shapes.
  return (body as Body)[key] as T
}

describe.skipIf(!jsDebugDir)('debug session against real js-debug', () => {
  it('stops at a breakpoint in a child session and exposes local variables', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'orca-js-debug-it-'))
    const program = join(workdir, 'app.js')
    await writeFile(program, 'let answer = 41\nanswer += 1\nconsole.log("answer=" + answer)\n')
    // Why node, not Electron: vitest already runs on node.
    const server = await startJsDebugServer(jsDebugDir!, {
      program: process.execPath,
      env: process.env
    })
    const events: DebugSessionEvent[] = []
    const session = startDebugSession({
      id: 'it',
      adapterId: 'pwa-node',
      transport: await connectTcpDapTransport(server.host, server.port),
      openChildTransport: () => connectTcpDapTransport(server.host, server.port),
      launchArguments: buildNodeLaunchArguments({
        target: { kind: 'file', filePath: program },
        cwd: workdir
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
        { timeout: 30_000 }
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
        () => {
          const output = events
            .flatMap((event) =>
              event.kind === 'dap-event' && event.event.event === 'output'
                ? [event.event.body?.output]
                : []
            )
            .join('')
          expect(output).toContain('answer=42')
        },
        { timeout: 30_000 }
      )
    } finally {
      await session.stop()
      server.dispose()
      await rm(workdir, { recursive: true, force: true })
    }
  }, 90_000)
})
