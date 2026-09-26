import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import {
  buildDotnetProject,
  buildNetcoredbgLaunchArguments,
  netcoredbgExecutable
} from './adapters/netcoredbg-adapter'
import { startStdioDapTransport } from './dap-transport-stdio'
import { startDebugSession } from './debug-session'

// Opt-in: point at an extracted netcoredbg release (the folder containing `netcoredbg/`).
const netcoredbgDir = process.env.ORCA_TEST_NETCOREDBG_DIR

type Body = Record<string, unknown>

function field<T>(body: unknown, key: string): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test reads known netcoredbg response shapes.
  return (body as Body)[key] as T
}

describe.skipIf(!netcoredbgDir)('debug session against real netcoredbg', () => {
  it('builds a console app, stops at a breakpoint and exposes locals', async () => {
    const dotnet = await resolveCommandOnLocalPath('dotnet')
    expect(dotnet).not.toBeNull()
    // Why realpath: the build records resolved source paths (macOS /var → /private/var).
    const workdir = await realpath(await mkdtemp(join(tmpdir(), 'orca-netcoredbg-it-')))
    await runProcess({
      program: dotnet!,
      args: ['new', 'console', '-n', 'Demo', '-o', workdir, '--force'],
      timeoutMs: 120_000
    })
    const program = join(workdir, 'Program.cs')
    await writeFile(
      program,
      'var answer = 41;\nanswer += 1;\nConsole.WriteLine("answer=" + answer);\n'
    )
    const buildOutput: string[] = []
    const assembly = await buildDotnetProject({
      dotnet: dotnet!,
      projectFile: join(workdir, 'Demo.csproj'),
      onOutput: (text) => buildOutput.push(text)
    })
    expect(assembly).toMatch(/Demo\.dll$/)

    const events: DebugSessionEvent[] = []
    const session = startDebugSession({
      id: 'it',
      adapterId: 'coreclr',
      transport: startStdioDapTransport({
        program: netcoredbgExecutable(netcoredbgDir!),
        args: ['--interpreter=vscode'],
        cwd: workdir,
        env: process.env
      }),
      launchArguments: buildNetcoredbgLaunchArguments({
        program: assembly,
        cwd: workdir,
        profile: null
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
        { timeout: 60_000 }
      )
      const threads = field<{ id: number }[]>(await session.request('threads', {}), 'threads')
      const stopped = events.find(
        (event) => event.kind === 'dap-event' && event.event.event === 'stopped'
      )
      const threadId =
        stopped?.kind === 'dap-event' && typeof stopped.event.body?.threadId === 'number'
          ? stopped.event.body.threadId
          : threads[0].id
      const frames = field<{ id: number; line: number }[]>(
        await session.request('stackTrace', { threadId }),
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

      await session.request('continue', { threadId })
      await vi.waitFor(
        () => expect(events).toContainEqual({ kind: 'phase', sessionId: 'it', phase: 'ended' }),
        { timeout: 60_000 }
      )
      const output = events
        .flatMap((event) =>
          event.kind === 'dap-event' && event.event.event === 'output'
            ? [event.event.body?.output]
            : []
        )
        .join('')
      expect(output).toContain('answer=42')
    } finally {
      await session.stop()
      await rm(workdir, { recursive: true, force: true })
    }
  }, 240_000)
})
