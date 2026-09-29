import { formatPosixCommand } from '../../shared/ssh-vpn-command-format'
import {
  CONTAINER_LOGIN_PATH,
  CONTAINER_PROFILE_PATH,
  type PreparedOvpnFile
} from './ovpn-profile-preparation'
import {
  dockerBuildArgs,
  dockerFirewallArgs,
  dockerImageInspectArgs,
  dockerInfoArgs,
  dockerOpenVpnArgs,
  dockerRemoveArgs,
  dockerRunArgs,
  dockerWriteFileArgs
} from './ssh-vpn-docker'

export type SshVpnStartPlan = {
  dockerPath: string
  containerName: string
  instanceTag: string
  profileId: string
  ovpnPath: string
  files: readonly Pick<PreparedOvpnFile, 'hostPath' | 'containerPath'>[]
  buildsImage: boolean
  /** The profile asks for a username and password, which Orca writes next to it. */
  writesLogin: boolean
}

/**
 * Every command a VPN start runs, in order, as the confirm dialog lists them. Built from the same
 * argv builders the manager runs, so what is shown is what runs.
 */
export function sshVpnStartCommands(plan: SshVpnStartPlan): string[] {
  const docker = (args: readonly string[]): string => formatPosixCommand([plan.dockerPath, ...args])
  const writeFile = (containerPath: string, source: string): string =>
    `${docker(dockerWriteFileArgs(plan.containerName, containerPath))}   # stdin: ${source}, base64`
  return [
    docker(dockerInfoArgs()),
    docker(dockerImageInspectArgs()),
    ...(plan.buildsImage ? [`${docker(dockerBuildArgs())}   # stdin: Orca's Dockerfile`] : []),
    docker(dockerRemoveArgs(plan.containerName)),
    docker(dockerRunArgs(plan.containerName, plan.instanceTag, plan.profileId)),
    docker(dockerFirewallArgs(plan.containerName)),
    writeFile(CONTAINER_PROFILE_PATH, `${plan.ovpnPath} (paths rewritten for the container)`),
    ...plan.files.map((file) => writeFile(file.containerPath, file.hostPath)),
    ...(plan.writesLogin
      ? [writeFile(CONTAINER_LOGIN_PATH, 'your VPN username and password (not shown)')]
      : []),
    docker(dockerOpenVpnArgs(plan.containerName, plan.writesLogin))
  ]
}
