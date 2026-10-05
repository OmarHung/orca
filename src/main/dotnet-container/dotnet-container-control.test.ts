import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult } from '../../shared/child-process/run-process'
import {
  readDotnetContainerStatus,
  resetDotnetContainer,
  stopDotnetContainer,
  type DockerRunner
} from './dotnet-container-control'

function result(code: number, stdout = '', stderr = ''): ProcessResult {
  return { code, signal: null, stdout, stderr, timedOut: false }
}

function runner(answers: Record<string, ProcessResult>): DockerRunner & { calls: string[] } {
  const calls: string[] = []
  const run = vi.fn(async (args: readonly string[]) => {
    calls.push(args.join(' '))
    return answers[args[0] ?? ''] ?? result(0)
  })
  return Object.assign(run, { calls })
}

describe('readDotnetContainerStatus', () => {
  it('distinguishes missing Docker, stopped Docker and each container state', async () => {
    expect(await readDotnetContainerStatus(null, 'c')).toEqual({
      docker: 'missing',
      container: 'none'
    })
    expect(await readDotnetContainerStatus(runner({ info: result(1) }), 'c')).toEqual({
      docker: 'stopped',
      container: 'none'
    })
    expect(await readDotnetContainerStatus(runner({ container: result(1) }), 'c')).toEqual({
      docker: 'running',
      container: 'none'
    })
    expect(
      await readDotnetContainerStatus(
        runner({ container: result(0, 'true orca-dotnet:abc\n') }),
        'c'
      )
    ).toEqual({ docker: 'running', container: 'running', image: 'orca-dotnet:abc' })
  })
})

describe('resetDotnetContainer', () => {
  it("removes the container and only Orca's .NET images", async () => {
    const docker = runner({ image: result(0, 'orca-dotnet:abc\norca-dotnet:def\n') })
    await resetDotnetContainer(docker, 'orca-dotnet-1')
    expect(docker.calls).toEqual([
      'rm --force orca-dotnet-1',
      'image ls --format {{.Repository}}:{{.Tag}} orca-dotnet',
      'rmi orca-dotnet:abc orca-dotnet:def'
    ])
  })
})

describe('docker failures', () => {
  it("reports Docker's reason, but not for a container that is already gone", async () => {
    await expect(
      stopDotnetContainer(runner({ stop: result(1, '', 'Error: permission denied\n') }), 'c')
    ).rejects.toThrow('Error: permission denied')
    await expect(
      stopDotnetContainer(runner({ stop: result(1, '', 'Error: No such container: c\n') }), 'c')
    ).resolves.toBeUndefined()
  })

  it("leaves an image another install's container still uses", async () => {
    const docker = runner({
      image: result(0, 'orca-dotnet:abc\n'),
      rmi: result(
        1,
        '',
        'Error response from daemon: conflict: unable to remove repository reference\n'
      )
    })
    await expect(resetDotnetContainer(docker, 'c')).resolves.toBeUndefined()
  })
})
