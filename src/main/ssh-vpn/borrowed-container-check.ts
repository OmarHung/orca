import { z } from 'zod'
import type { ProcessResult } from '../../shared/child-process/run-process'
import { SSH_VPN_TUNNEL_USER } from '../../shared/ssh-vpn-command-format'
import type { SshVpnContainerCandidate } from '../../shared/ssh-vpn-types'
import { keepsTunnelUserOnVpn } from './borrowed-container-firewall'
import { SSH_VPN_LABEL } from './ssh-vpn-image'

/** The docker calls a borrowed container needs; all of them only read. */
export type BorrowedContainerDocker = {
  dockerPath: string
  query(args: readonly string[]): Promise<ProcessResult>
}

export class BorrowedContainerError extends Error {
  override name = 'BorrowedContainerError'
}

const SECTION = '@@orca-section@@'
const NO_TUNNEL_USER_EXIT = 3

// Why root: listing iptables rules needs it, whatever user the container's image runs as.
const FIREWALL_QUERY = [
  `id -u ${SSH_VPN_TUNNEL_USER} || exit ${NO_TUNNEL_USER_EXIT}`,
  `echo ${SECTION}`,
  'iptables -S OUTPUT',
  `echo ${SECTION}`,
  'ip6tables -S OUTPUT'
].join(' && ')

const containerStateSchema = z.object({
  Running: z.boolean(),
  Status: z.string(),
  Health: z.object({ Status: z.string() }).nullish()
})

export function dockerContainerStateArgs(containerName: string): string[] {
  return ['container', 'inspect', '--format', '{{json .State}}', containerName]
}

export function dockerContainerFirewallQueryArgs(containerName: string): string[] {
  return ['exec', '--user', '0', containerName, 'sh', '-c', FIREWALL_QUERY]
}

export function dockerRunningContainersArgs(): string[] {
  return ['ps', '--format', `{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Label "${SSH_VPN_LABEL}"}}`]
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/).find(Boolean) ?? ''
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function assertRunning(
  docker: BorrowedContainerDocker,
  containerName: string,
  requireHealthy: boolean
): Promise<void> {
  const result = await docker.query(dockerContainerStateArgs(containerName))
  if (result.code !== 0) {
    throw new BorrowedContainerError(
      /no such container/i.test(result.stderr)
        ? `Docker has no container named "${containerName}". Start it and try again.`
        : `Could not inspect container "${containerName}": ${firstLine(result.stderr) || `exit ${result.code}`}`
    )
  }
  const state = containerStateSchema.safeParse(parseJson(result.stdout))
  if (!state.success) {
    throw new BorrowedContainerError(`Docker reported an unexpected state for "${containerName}"`)
  }
  if (!state.data.Running) {
    throw new BorrowedContainerError(
      `Container "${containerName}" is ${state.data.Status}. Start it and try again.`
    )
  }
  const health = state.data.Health?.Status
  // Why only with a healthcheck: without one, Orca cannot tell, and the firewall still fails closed.
  if (requireHealthy && health && health !== 'healthy') {
    throw new BorrowedContainerError(
      `Container "${containerName}" has not connected its VPN yet (health: ${health}). Try again once it is healthy.`
    )
  }
}

async function assertFailsClosed(
  docker: BorrowedContainerDocker,
  containerName: string
): Promise<void> {
  const result = await docker.query(dockerContainerFirewallQueryArgs(containerName))
  if (result.code === NO_TUNNEL_USER_EXIT) {
    throw new BorrowedContainerError(
      `Container "${containerName}" has no "${SSH_VPN_TUNNEL_USER}" user. Orca runs every connection as that user, behind a firewall that only lets it out through the VPN.`
    )
  }
  if (result.code !== 0) {
    throw new BorrowedContainerError(
      `Could not read the firewall of container "${containerName}": ${firstLine(result.stderr) || `exit ${result.code}`}`
    )
  }
  const [uid = '', ipv4 = '', ipv6 = ''] = result.stdout.split(SECTION)
  const tunnelUid = uid.trim()
  if (!keepsTunnelUserOnVpn(ipv4, tunnelUid) || !keepsTunnelUserOnVpn(ipv6, tunnelUid)) {
    throw new BorrowedContainerError(
      `Container "${containerName}" does not keep the "${SSH_VPN_TUNNEL_USER}" user on the VPN. Its iptables and ip6tables OUTPUT rules must let that user out only through tun+ (and DNS to fixed resolvers) and reject the rest.`
    )
  }
}

/**
 * Checks that connections through the container stay on its VPN; throws why they would not.
 * `requireHealthy` also waits for a container healthcheck (e.g. "tun0 is up") to pass.
 */
export async function checkBorrowedContainer(
  docker: BorrowedContainerDocker,
  containerName: string,
  { requireHealthy }: { requireHealthy: boolean }
): Promise<void> {
  await assertRunning(docker, containerName, requireHealthy)
  await assertFailsClosed(docker, containerName)
}

/** Running containers the form offers; Orca's own VPN containers are left out. */
export async function listBorrowableContainers(
  docker: BorrowedContainerDocker
): Promise<SshVpnContainerCandidate[]> {
  const result = await docker.query(dockerRunningContainersArgs())
  if (result.code !== 0) {
    throw new BorrowedContainerError(
      `Could not list Docker containers: ${firstLine(result.stderr) || `exit ${result.code}`}`
    )
  }
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const [name, image, status, orcaLabel] = line.split('\t')
    return name && !orcaLabel ? [{ name, image: image ?? '', status: status ?? '' }] : []
  })
}
