import { runProcess, type ProcessResult } from '../../shared/child-process/run-process'
import type { DotnetContainerStatus } from '../../shared/dotnet-container-types'

const DOCKER_TIMEOUT_MS = 15_000

export type DockerRunner = (args: readonly string[]) => Promise<ProcessResult>

export function dockerRunner(dockerPath: string): DockerRunner {
  return (args) => runProcess({ program: dockerPath, args, timeoutMs: DOCKER_TIMEOUT_MS })
}

/** Throws Docker's reason, unless every error line is `tolerated` (the wanted state already holds). */
async function runDocker(
  docker: DockerRunner,
  args: readonly string[],
  tolerated?: RegExp
): Promise<ProcessResult> {
  const result = await docker(args)
  const errors = result.stderr.split('\n').filter((line) => line.trim().length > 0)
  if (
    result.code === 0 ||
    (tolerated && errors.length > 0 && errors.every((line) => tolerated.test(line)))
  ) {
    return result
  }
  throw new Error(errors.at(-1) ?? `docker ${args[0]} failed`)
}

/** What the Run menu shows about the container; never throws. */
export async function readDotnetContainerStatus(
  docker: DockerRunner | null,
  containerName: string
): Promise<DotnetContainerStatus> {
  if (!docker) {
    return { docker: 'missing', container: 'none' }
  }
  if ((await docker(['info', '--format', '{{.ServerVersion}}']).catch(() => null))?.code !== 0) {
    return { docker: 'stopped', container: 'none' }
  }
  const inspect = await docker([
    'container',
    'inspect',
    '--format',
    '{{.State.Running}} {{.Config.Image}}',
    containerName
  ]).catch(() => null)
  if (inspect?.code !== 0) {
    return { docker: 'running', container: 'none' }
  }
  const [running, image] = inspect.stdout.trim().split(' ')
  return {
    docker: 'running',
    container: running === 'true' ? 'running' : 'stopped',
    ...(image ? { image } : {})
  }
}

/** Stops the container (and every program in it); the next .NET run starts it again. */
export async function stopDotnetContainer(
  docker: DockerRunner,
  containerName: string
): Promise<void> {
  await runDocker(docker, ['stop', containerName], /no such container/i)
}

/** Removes the container and Orca's .NET images, so the next run rebuilds from scratch. */
export async function resetDotnetContainer(
  docker: DockerRunner,
  containerName: string
): Promise<void> {
  await runDocker(docker, ['rm', '--force', containerName], /no such container/i)
  const images = await runDocker(docker, [
    'image',
    'ls',
    '--format',
    '{{.Repository}}:{{.Tag}}',
    'orca-dotnet'
  ])
  const tags = images.stdout.split('\n').filter((tag) => tag.startsWith('orca-dotnet:'))
  if (tags.length > 0) {
    // Why tolerate conflicts: another Orca install's container may still use one of these images.
    await runDocker(docker, ['rmi', ...tags], /conflict|no such image/i)
  }
}
