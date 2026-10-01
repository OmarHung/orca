import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  runProcess,
  spawnProcess,
  type ProcessResult
} from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import {
  CONTAINER_LOGIN_PATH,
  CONTAINER_PROFILE_DIR,
  CONTAINER_PROFILE_PATH
} from './ovpn-profile-preparation'
import {
  SSH_VPN_DNS_SCRIPT_PATH,
  SSH_VPN_FIREWALL_SCRIPT_PATH,
  SSH_VPN_DOCKERFILE,
  SSH_VPN_IMAGE,
  SSH_VPN_LABEL
} from './ssh-vpn-image'

const DOCKER_COMMAND_TIMEOUT_MS = 30_000
const DOCKER_BUILD_TIMEOUT_MS = 10 * 60_000

export class SshVpnDockerError extends Error {
  override name = 'SshVpnDockerError'
}

/** Where Docker Desktop, OrbStack, Colima and Homebrew put the CLI when PATH does not have it. */
function wellKnownDockerPaths(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    return [path.win32.join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')]
  }
  if (platform === 'darwin') {
    return [
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      path.join(os.homedir(), '.orbstack', 'bin', 'docker'),
      '/Applications/Docker.app/Contents/Resources/bin/docker'
    ]
  }
  return ['/usr/bin/docker', '/usr/local/bin/docker']
}

export async function resolveDockerPath(): Promise<string | null> {
  const onPath = await resolveCommandOnLocalPath(
    process.platform === 'win32' ? 'docker.exe' : 'docker'
  )
  return (
    onPath ??
    wellKnownDockerPaths(process.platform).find((candidate) => existsSync(candidate)) ??
    null
  )
}

export function sshVpnContainerName(instanceTag: string, profileId: string): string {
  return `orca-ssh-vpn-${instanceTag}-${profileId}`
}

export function instanceLabel(instanceTag: string): string {
  return `${SSH_VPN_LABEL}.instance=${instanceTag}`
}

// ─── argv builders: used both to run and to show the user exactly what runs ──

export function dockerRunArgs(
  containerName: string,
  instanceTag: string,
  profileId: string
): string[] {
  return [
    'run',
    '--detach',
    '--rm',
    '--init',
    '--name',
    containerName,
    '--label',
    `${SSH_VPN_LABEL}=1`,
    '--label',
    instanceLabel(instanceTag),
    '--label',
    `${SSH_VPN_LABEL}.profile=${profileId}`,
    '--cap-add',
    'NET_ADMIN',
    '--device',
    '/dev/net/tun',
    '--tmpfs',
    `${CONTAINER_PROFILE_DIR}:rw,mode=0700`,
    SSH_VPN_IMAGE,
    'sleep',
    'infinity'
  ]
}

/** Streams a file in on stdin (base64, so binary PKCS#12 survives) into the container's tmpfs. */
export function dockerWriteFileArgs(containerName: string, containerPath: string): string[] {
  return [
    'exec',
    '-i',
    containerName,
    'sh',
    '-c',
    'umask 077 && base64 -d > "$1"',
    'sh',
    containerPath
  ]
}

/** `withLogin`: read the username and password Orca wrote to the tmpfs, never keep them after use. */
export function dockerOpenVpnArgs(containerName: string, withLogin = false): string[] {
  return [
    'exec',
    containerName,
    'openvpn',
    '--config',
    CONTAINER_PROFILE_PATH,
    // Why after --config: later options win, so the profile cannot replace Orca's DNS hook.
    '--script-security',
    '2',
    '--up',
    SSH_VPN_DNS_SCRIPT_PATH,
    // Why: servers (e.g. ASUS routers) push this Windows-only option; Linux OpenVPN only warns.
    '--pull-filter',
    'ignore',
    'block-outside-dns',
    ...(withLogin ? ['--auth-user-pass', CONTAINER_LOGIN_PATH, '--auth-nocache'] : []),
    '--verb',
    '3'
  ]
}

/** Installs the rules that keep per-connection traffic on the VPN; see the image's firewall script. */
export function dockerFirewallArgs(containerName: string): string[] {
  return ['exec', containerName, SSH_VPN_FIREWALL_SCRIPT_PATH]
}

export function dockerRemoveArgs(...containerNames: string[]): string[] {
  return ['rm', '--force', ...containerNames]
}

export function dockerBuildArgs(): string[] {
  return ['build', '--tag', SSH_VPN_IMAGE, '-']
}

export function dockerInfoArgs(): string[] {
  return ['info', '--format', '{{.ServerVersion}}']
}

export function dockerImageInspectArgs(): string[] {
  return ['image', 'inspect', SSH_VPN_IMAGE]
}

type Runner = (
  args: readonly string[],
  options?: { input?: string; timeoutMs?: number }
) => Promise<ProcessResult>

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/).find(Boolean) ?? ''
}

/** Thin wrapper over the docker CLI. Every call is an argv array; nothing goes through a shell. */
export class SshVpnDocker {
  private readonly run: Runner

  constructor(
    readonly dockerPath: string,
    run?: Runner
  ) {
    this.run =
      run ??
      ((args, options) =>
        runProcess({
          program: dockerPath,
          args,
          input: options?.input,
          timeoutMs: options?.timeoutMs ?? DOCKER_COMMAND_TIMEOUT_MS
        }))
  }

  private async runChecked(
    args: readonly string[],
    failure: string,
    options?: { input?: string; timeoutMs?: number }
  ): Promise<ProcessResult> {
    const result = await this.run(args, options)
    if (result.code !== 0) {
      const detail =
        firstLine(result.stderr) ||
        firstLine(result.stdout) ||
        (result.timedOut ? 'timed out' : `exit ${result.code}`)
      throw new SshVpnDockerError(`${failure}: ${detail}`)
    }
    return result
  }

  /** Runs a read-only command (inspect, ps) and hands back the result for the caller to judge. */
  query(args: readonly string[]): Promise<ProcessResult> {
    return this.run(args)
  }

  async assertRunning(): Promise<void> {
    await this.runChecked(
      dockerInfoArgs(),
      'Docker is not running. Start Docker Desktop (or OrbStack/Colima) and try again'
    )
  }

  async hasImage(): Promise<boolean> {
    return (await this.run(dockerImageInspectArgs())).code === 0
  }

  async buildImage(): Promise<void> {
    await this.runChecked(dockerBuildArgs(), 'Could not build the VPN image', {
      input: SSH_VPN_DOCKERFILE,
      timeoutMs: DOCKER_BUILD_TIMEOUT_MS
    })
  }

  async startContainer(
    containerName: string,
    instanceTag: string,
    profileId: string
  ): Promise<void> {
    await this.runChecked(
      dockerRunArgs(containerName, instanceTag, profileId),
      'Could not start the VPN container'
    )
  }

  async applyFirewall(containerName: string): Promise<void> {
    await this.runChecked(
      dockerFirewallArgs(containerName),
      "Could not set up the VPN container's firewall"
    )
  }

  async writeFile(containerName: string, containerPath: string, content: Buffer): Promise<void> {
    await this.runChecked(
      dockerWriteFileArgs(containerName, containerPath),
      'Could not copy the VPN profile into its container',
      {
        input: content.toString('base64')
      }
    )
  }

  spawnOpenVpn(containerName: string, withLogin: boolean): ReturnType<typeof spawnProcess> {
    return spawnProcess({
      program: this.dockerPath,
      args: dockerOpenVpnArgs(containerName, withLogin)
    })
  }

  /** How many connections are using the tunnel right now (one `nc` each). */
  async countTunnels(containerName: string): Promise<number> {
    const result = await this.run(['exec', containerName, 'pgrep', '-x', 'nc'])
    if (result.code === 1) {
      return 0
    }
    if (result.code !== 0) {
      throw new SshVpnDockerError(firstLine(result.stderr) || 'Could not inspect the VPN container')
    }
    return result.stdout.split(/\r?\n/).filter((line) => line.trim()).length
  }

  async remove(containerName: string): Promise<void> {
    await this.run(dockerRemoveArgs(containerName))
  }

  async listContainers(instanceTag: string): Promise<string[]> {
    const result = await this.run([
      'ps',
      '--all',
      '--filter',
      `label=${instanceLabel(instanceTag)}`,
      '--format',
      '{{.Names}}'
    ])
    return result.code === 0
      ? result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : []
  }
}
