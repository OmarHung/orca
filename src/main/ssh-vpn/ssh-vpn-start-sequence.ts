import type {
  SshVpnCredentials,
  SshVpnOvpnProfile,
  SshVpnProfile,
  SshVpnStartPreview
} from '../../shared/ssh-vpn-types'
import {
  CONTAINER_LOGIN_PATH,
  CONTAINER_PROFILE_PATH,
  prepareOvpnProfile,
  type PreparedOvpnProfile
} from './ovpn-profile-preparation'
import {
  SshVpnStartDeclinedError,
  type SshVpnDockerPort,
  type SshVpnStartOptions
} from './ssh-vpn-manager-types'
import { sshVpnContainerName } from './ssh-vpn-docker'
import { sshVpnStartCommands } from './ssh-vpn-start-commands'

type PlanInput = {
  docker: SshVpnDockerPort
  profile: SshVpnOvpnProfile
  containerName: string
  instanceTag: string
  readFile: (filePath: string) => Promise<Buffer>
}

type LaunchInput = PlanInput & {
  options: SshVpnStartOptions
  /** The user said no (to the commands or the login); counted before this throws. */
  onDeclined: () => void
}

async function loginFor(input: LaunchInput): Promise<SshVpnCredentials> {
  if (!input.options.credentials) {
    throw new Error('This profile asks for a username and password')
  }
  const login = await input.options.credentials()
  if (!login) {
    input.onDeclined()
    throw new SshVpnStartDeclinedError(`VPN "${input.profile.name}" was not started`)
  }
  return login
}

/** Reads the profile and checks Docker, then lists every command a start runs; changes nothing. */
export async function planSshVpnStart(
  input: PlanInput
): Promise<{ prepared: PreparedOvpnProfile; buildsImage: boolean; commands: string[] }> {
  const { docker, profile } = input
  const prepared = await prepareOvpnProfile(profile.ovpnPath, input.readFile)
  await docker.assertRunning()
  const buildsImage = !(await docker.hasImage())
  const commands = sshVpnStartCommands({
    dockerPath: docker.dockerPath,
    containerName: input.containerName,
    instanceTag: input.instanceTag,
    profileId: profile.id,
    ovpnPath: profile.ovpnPath,
    files: prepared.files,
    buildsImage,
    writesLogin: prepared.needsCredentials
  })
  return { prepared, buildsImage, commands }
}

type PreviewDeps = Pick<PlanInput, 'instanceTag' | 'readFile'> & {
  docker: () => Promise<SshVpnDockerPort>
  isReady: (profileId: string) => boolean
}

/** What acquiring a profile would take right now, for the start confirmation; starts nothing. */
export async function previewSshVpnStart(
  deps: PreviewDeps,
  profile: SshVpnProfile
): Promise<SshVpnStartPreview> {
  if (profile.kind === 'container') {
    return { kind: 'borrowed', containerName: profile.containerName }
  }
  if (deps.isReady(profile.id)) {
    return { kind: 'ready' }
  }
  const { commands } = await planSshVpnStart({
    docker: await deps.docker(),
    profile,
    containerName: sshVpnContainerName(deps.instanceTag, profile.id),
    instanceTag: deps.instanceTag,
    readFile: deps.readFile
  })
  return { kind: 'start', commands }
}

/**
 * Every step of a start before OpenVPN runs, in the order the confirm dialog lists them. Nothing
 * touches Docker's state before the user approves. Returns whether OpenVPN must read a login.
 */
export async function prepareSshVpnContainer(input: LaunchInput): Promise<{ usesLogin: boolean }> {
  const { docker, profile, containerName, instanceTag, options } = input
  const { prepared, buildsImage, commands } = await planSshVpnStart(input)
  if (options.confirm && !(await options.confirm(commands))) {
    input.onDeclined()
    throw new SshVpnStartDeclinedError(`VPN "${profile.name}" was not started`)
  }
  const login = prepared.needsCredentials ? await loginFor(input) : null
  if (buildsImage) {
    await docker.buildImage()
  }
  await docker.remove(containerName)
  await docker.startContainer(containerName, instanceTag, profile.id)
  await docker.applyFirewall(containerName)
  const files = [
    { containerPath: CONTAINER_PROFILE_PATH, content: Buffer.from(prepared.config) },
    ...prepared.files,
    ...(login
      ? [
          {
            containerPath: CONTAINER_LOGIN_PATH,
            content: Buffer.from(`${login.username}\n${login.password}\n`)
          }
        ]
      : [])
  ]
  for (const file of files) {
    await docker.writeFile(containerName, file.containerPath, file.content)
  }
  return { usesLogin: login !== null }
}
