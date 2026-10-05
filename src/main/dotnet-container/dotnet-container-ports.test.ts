import { describe, expect, it, vi } from 'vitest'
import type { RawListeningPort } from '../ports/local-workspace-port-scan-state'
import {
  forwardedContainerListener,
  parseContainerListeners,
  resolveDotnetContainerListeners,
  stopForwardedContainerListener,
  type DotnetContainerPortsDeps
} from './dotnet-container-ports'

const DOCKER_BACKEND: Pick<RawListeningPort, 'pid' | 'processName' | 'commandLine' | 'cwd'> = {
  pid: 900,
  processName: 'com.docke',
  commandLine: '/Applications/Docker.app/Contents/MacOS/com.docker.backend services',
  cwd: '/'
}

function deps(output: string | null, overrides: Partial<DotnetContainerPortsDeps> = {}) {
  return {
    platform: 'darwin' as const,
    isEnabled: () => true,
    exec: vi.fn(async () => output),
    ...overrides
  }
}

describe('parseContainerListeners', () => {
  it('reads tab-separated port, pid, cwd and command line, skipping incomplete lines', () => {
    expect(
      parseContainerListeners(
        '5000\t412\t/Volumes/W D/site\tdotnet exec bin/App.dll \n\n8080\tx\t/a\tb\n'
      )
    ).toEqual([
      { port: 5000, pid: 412, cwd: '/Volumes/W D/site', commandLine: 'dotnet exec bin/App.dll' }
    ])
  })
})

describe('resolveDotnetContainerListeners', () => {
  it('only treats Docker Desktop as the forwarder, not any process mentioning a container', async () => {
    const ports: RawListeningPort[] = [
      {
        host: '127.0.0.1',
        port: 5000,
        pid: 31,
        processName: 'node',
        commandLine: 'node /Users/me/src/container-demo/server.js',
        cwd: '/Users/me/src/container-demo'
      }
    ]
    const current = deps('5000\t412\t/repo/site\tdotnet exec App.dll\n')
    expect(await resolveDotnetContainerListeners(ports, current)).toEqual(ports)
    expect(current.exec).not.toHaveBeenCalled()
  })

  it('gives Docker-forwarded ports the cwd of the program listening in the container', async () => {
    const ports: RawListeningPort[] = [
      { host: '127.0.0.1', port: 5000, ...DOCKER_BACKEND },
      { host: '127.0.0.1', port: 1433, ...DOCKER_BACKEND },
      { host: '127.0.0.1', port: 5173, pid: 77, processName: 'node', cwd: '/repo' }
    ]
    const resolved = await resolveDotnetContainerListeners(
      ports,
      deps('5000\t412\t/repo/site\tdotnet exec App.dll\n')
    )
    expect(resolved[0]).toMatchObject({ cwd: '/repo/site', commandLine: 'dotnet exec App.dll' })
    expect(resolved[1]).toEqual(ports[1])
    expect(resolved[2]).toEqual(ports[2])
    expect(forwardedContainerListener(900, 5000)).toMatchObject({ pid: 412 })
    expect(forwardedContainerListener(900, 1433)).toBeNull()
  })

  it('leaves ports alone off macOS, with the toolchain off, or when the container cannot answer', async () => {
    const ports: RawListeningPort[] = [{ host: '127.0.0.1', port: 5000, ...DOCKER_BACKEND }]
    for (const current of [
      deps('5000\t1\t/x\ty\n', { platform: 'linux' }),
      deps('5000\t1\t/x\ty\n', { isEnabled: () => false }),
      deps(null),
      deps('', {
        exec: vi.fn(async () => {
          throw new Error('timed out')
        })
      })
    ]) {
      expect(await resolveDotnetContainerListeners(ports, current)).toEqual(ports)
      expect(forwardedContainerListener(900, 5000)).toBeNull()
    }
  })

  it('does not ask Docker when no port is forwarded by it', async () => {
    const current = deps('5000\t1\t/x\ty\n')
    await resolveDotnetContainerListeners([{ host: '127.0.0.1', port: 5173, pid: 7 }], current)
    expect(current.exec).not.toHaveBeenCalled()
  })
})

describe('stopForwardedContainerListener', () => {
  it('signals the program inside the container, never the Mac-side pid', async () => {
    const current = deps('')
    expect(
      await stopForwardedContainerListener(
        { port: 5000, pid: 412, cwd: '/r', commandLine: '' },
        current
      )
    ).toBe(true)
    expect(current.exec).toHaveBeenCalledWith(['kill', '-TERM', '412'], expect.any(Number))
    expect(
      await stopForwardedContainerListener(
        { port: 5000, pid: 412, cwd: '/r', commandLine: '' },
        deps(null)
      )
    ).toBe(false)
  })
})
