import type { SshVpnCredentials, SshVpnProfile } from '../../shared/ssh-vpn-types'
import {
  CONTAINER_LOGIN_PATH,
  CONTAINER_PROFILE_PATH,
  prepareOvpnProfile
} from './ovpn-profile-preparation'
import {
  SshVpnStartDeclinedError,
  type SshVpnDockerPort,
  type SshVpnStartOptions
} from './ssh-vpn-manager-types'
import { sshVpnStartCommands } from './ssh-vpn-start-commands'

type LaunchInput = {
  docker: SshVpnDockerPort
  profile: SshVpnProfile
  containerName: string
  instanceTag: string
  readFile: (filePath: string) => Promise<Buffer>
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

/**
 * Every step of a start before OpenVPN runs, in the order the confirm dialog lists them. Nothing
 * touches Docker's state before the user approves. Returns whether OpenVPN must read a login.
 */
export async function prepareSshVpnContainer(input: LaunchInput): Promise<{ usesLogin: boolean }> {
  const { docker, profile, containerName, instanceTag, options } = input
  const prepared = await prepareOvpnProfile(profile.ovpnPath, input.readFile)
  await docker.assertRunning()
  const buildsImage = !(await docker.hasImage())
  if (options.confirm) {
    const commands = sshVpnStartCommands({
      dockerPath: docker.dockerPath,
      containerName,
      instanceTag,
      profileId: profile.id,
      ovpnPath: profile.ovpnPath,
      files: prepared.files,
      buildsImage,
      writesLogin: prepared.needsCredentials
    })
    if (!(await options.confirm(commands))) {
      input.onDeclined()
      throw new SshVpnStartDeclinedError(`VPN "${profile.name}" was not started`)
    }
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
