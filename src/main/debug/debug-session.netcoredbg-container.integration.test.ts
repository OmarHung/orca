import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import type { DebugSessionEvent } from '../../shared/debug/debug-session-types'
import { prepareNetcoredbg } from './adapters/netcoredbg-launch'
import { startDebugSession } from './debug-session'

// Opt-in: an installed .NET container launcher, and a folder the container mounts (home or /Volumes).
const launcher = process.env.ORCA_TEST_DOTNET_CONTAINER_LAUNCHER
const parentDir = process.env.ORCA_TEST_DOTNET_CONTAINER_WORKDIR

function field<T>(body: unknown, key: string): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test reads known netcoredbg response shapes.
  return (body as Record<string, unknown>)[key] as T
}

describe.skipIf(!launcher || !parentDir)('debug session in the .NET container', () => {
  it.each(['netcoreapp2.1', 'netcoreapp3.1'])(
    'builds a %s app, stops at a breakpoint and exposes locals',
    async (framework) => {
      const workdir = await realpath(await mkdtemp(join(parentDir!, 'orca-container-dbg-')))
      const projectFile = join(workdir, 'Demo.csproj')
      await writeFile(
        projectFile,
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>${framework}</TargetFramework></PropertyGroup></Project>`
      )
      const source = join(workdir, 'Program.cs')
      await writeFile(
        source,
        'class Program {\n  static void Main() {\n    var answer = 41;\n    answer += 1;\n    System.Console.WriteLine("answer=" + answer);\n  }\n}\n'
      )
      const console: string[] = []
      const prepared = await prepareNetcoredbg(
        {
          adaptersDir: workdir,
          cwd: workdir,
          onInstalling: () => {},
          onOutput: (text) => console.push(text),
          dotnetContainerLauncher: async () => launcher!
        },
        { projectFile }
      )
      expect(console.join('')).toContain("Debugging in Orca's .NET container")

      const events: DebugSessionEvent[] = []
      const session = startDebugSession({
        id: 'it',
        adapterId: prepared.adapterId,
        transport: prepared.transport,
        launchArguments: prepared.launchArguments,
        breakpoints: { [source]: [{ line: 4 }] },
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
        const stopped = events.find(
          (event) => event.kind === 'dap-event' && event.event.event === 'stopped'
        )
        const threadId =
          stopped?.kind === 'dap-event' && typeof stopped.event.body?.threadId === 'number'
            ? stopped.event.body.threadId
            : 0
        const stackFrames = field<{ id: number; line: number }[]>(
          await session.request('stackTrace', { threadId }),
          'stackFrames'
        )
        expect(stackFrames[0]?.line).toBe(4)
        const scopes = field<{ variablesReference: number }[]>(
          await session.request('scopes', { frameId: stackFrames[0]!.id }),
          'scopes'
        )
        const variables = field<{ name: string; value: string }[]>(
          await session.request('variables', { variablesReference: scopes[0]!.variablesReference }),
          'variables'
        )
        expect(variables).toContainEqual(expect.objectContaining({ name: 'answer', value: '41' }))

        await session.request('continue', { threadId })
        await vi.waitFor(
          () => expect(events).toContainEqual({ kind: 'phase', sessionId: 'it', phase: 'ended' }),
          { timeout: 60_000 }
        )
      } finally {
        await session.stop()
        prepared.dispose()
        await rm(workdir, { recursive: true, force: true })
      }
    },
    300_000
  )
})
