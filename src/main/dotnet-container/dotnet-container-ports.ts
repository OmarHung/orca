import { runProcess } from '../../shared/child-process/run-process'
import { resolveDockerPath } from '../docker/docker-cli-location'
import type { RawListeningPort } from '../ports/local-workspace-port-scan-state'
import { ORCA_EXEC_PATH } from './dotnet-container-assets'

const LIST_TIMEOUT_MS = 3_000
const STOP_TIMEOUT_MS = 5_000

export type ContainerListener = { port: number; pid: number; cwd: string; commandLine: string }

export type DotnetContainerPortsDeps = {
  platform: NodeJS.Platform
  isEnabled: () => boolean
  /** `docker exec` into the container; null when Docker or the container is unavailable. */
  exec: (args: readonly string[], timeoutMs: number) => Promise<string | null>
}

let deps: DotnetContainerPortsDeps | null = null
/** Ports from the latest scan that Docker forwards from the container, keyed `pid:port`. */
let forwarded = new Map<string, ContainerListener>()

export function configureDotnetContainerPorts(options: {
  containerName: string
  isEnabled: () => boolean
}): void {
  deps = {
    platform: process.platform,
    isEnabled: options.isEnabled,
    exec: async (args, timeoutMs) => {
      const docker = await resolveDockerPath()
      if (!docker) {
        return null
      }
      const result = await runProcess({
        program: docker,
        args: ['exec', options.containerName, ...args],
        timeoutMs
      })
      return result.code === 0 ? result.stdout : null
    }
  }
}

/** Docker Desktop's forwarder, which holds every container port on the Mac (lsof cuts names to 9 chars). */
export function isDockerDesktopForwarder(
  port: Pick<RawListeningPort, 'processName' | 'commandLine'>
): boolean {
  return /\bcom\.docke|\bvpnkit/.test(`${port.processName ?? ''} ${port.commandLine ?? ''}`)
}

/** Reads `orca-exec --ports` lines: port, pid, cwd, command line, tab-separated. */
export function parseContainerListeners(output: string): ContainerListener[] {
  return output.split('\n').flatMap((line) => {
    const [port, pid, cwd = '', commandLine = ''] = line.split('\t')
    const listener = { port: Number(port), pid: Number(pid), cwd, commandLine: commandLine.trim() }
    return Number.isSafeInteger(listener.port) && Number.isSafeInteger(listener.pid) && cwd
      ? [listener]
      : []
  })
}

/**
 * Docker Desktop's backend owns every port the container listens on, so attribution would see
 * Docker instead of the program. Substitutes the program's cwd and command line (container paths
 * equal host paths) for those ports; anything unexpected leaves the ports as scanned.
 */
export async function resolveDotnetContainerListeners(
  ports: RawListeningPort[],
  current: DotnetContainerPortsDeps | null = deps
): Promise<RawListeningPort[]> {
  const candidates = ports.filter((port) => isDockerDesktopForwarder(port))
  if (!current || current.platform !== 'darwin' || !current.isEnabled() || !candidates.length) {
    forwarded = new Map()
    return ports
  }
  const output = await current.exec([ORCA_EXEC_PATH, '--ports'], LIST_TIMEOUT_MS).catch(() => null)
  const byPort = new Map(parseContainerListeners(output ?? '').map((l) => [l.port, l]))
  const next = new Map<string, ContainerListener>()
  const resolved = ports.map((port) => {
    const listener = isDockerDesktopForwarder(port) ? byPort.get(port.port) : undefined
    if (!listener) {
      return port
    }
    next.set(`${port.pid ?? ''}:${port.port}`, listener)
    return { ...port, cwd: listener.cwd, commandLine: listener.commandLine }
  })
  forwarded = next
  return resolved
}

/** The container program behind a port the latest scan resolved, if any. */
export function forwardedContainerListener(pid: number, port: number): ContainerListener | null {
  return forwarded.get(`${pid}:${port}`) ?? null
}

/** Signals the program inside the container; the Mac-side pid is Docker's own backend. */
export async function stopForwardedContainerListener(
  listener: ContainerListener,
  current: DotnetContainerPortsDeps | null = deps
): Promise<boolean> {
  const output = await current
    ?.exec(['kill', '-TERM', String(listener.pid)], STOP_TIMEOUT_MS)
    .catch(() => null)
  return output !== null && output !== undefined
}
