import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { quotePosixArg } from '../../shared/ssh-vpn-command-format'
import {
  installDotnetContainerLauncher,
  type DotnetContainerHost
} from './dotnet-container-install'

function host(overrides: Partial<DotnetContainerHost> = {}): DotnetContainerHost {
  return {
    platform: 'darwin',
    arch: 'arm64',
    home: '/Users/dev',
    uid: 501,
    gid: 20,
    timeZone: 'Asia/Taipei',
    resolveDocker: async () => '/usr/local/bin/docker',
    ...overrides
  }
}

describe('installDotnetContainerLauncher', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(os.tmpdir(), 'orca-dotnet-install-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('writes an executable launcher next to the Dockerfile it builds from', async () => {
    const launcher = await installDotnetContainerLauncher(userData, host())
    expect(launcher).toBe(join(userData, 'dotnet-container', 'dotnet'))
    expect(() => accessSync(launcher ?? '', constants.X_OK)).not.toThrow()
    const script = readFileSync(launcher ?? '', 'utf8')
    expect(script).toContain('orca_docker=/usr/local/bin/docker')
    expect(script).toContain(
      `orca_dockerfile=${quotePosixArg(join(userData, 'dotnet-container', 'Dockerfile'))}`
    )
    expect(script).toContain(
      `orca_cert_dir=${quotePosixArg(join(userData, 'dotnet-container', 'https'))}`
    )
    expect(readFileSync(join(userData, 'dotnet-container', 'Dockerfile'), 'utf8')).toContain(
      'linux-arm64'
    )
  })

  it('mounts the home folder and /Volumes on macOS at the same paths, as the host user', async () => {
    const script = readFileSync(
      (await installDotnetContainerLauncher(userData, host())) ?? '',
      'utf8'
    )
    expect(script).toContain('--volume /Users/dev:/Users/dev --volume /Volumes:/Volumes')
    expect(script).toContain('--user 501:20')
    expect(script).toContain('--network host')
    expect(script).toContain('--env TZ=Asia/Taipei')
    expect(script).toMatch(/--label dev\.orca\.dotnet-container\.config=[0-9a-f]{12}/)
    expect(script).toContain('/Users/dev/*|/Volumes/*) return 0 ;;')
    expect(script).toContain(
      "orca_docker_settings='/Users/dev/Library/Group Containers/group.com.docker/settings-store.json'"
    )
    expect(script).toContain('export DOCKER_CLI_HINTS=false')
  })

  it('gives the container a new settings hash when a mounted folder changes', async () => {
    const configOf = (script: string): string | undefined =>
      /^orca_config=(\S+)$/m.exec(script)?.[1]
    const mac = readFileSync((await installDotnetContainerLauncher(userData, host())) ?? '', 'utf8')
    const other = readFileSync(
      (await installDotnetContainerLauncher(userData, host({ home: '/Users/other' }))) ?? '',
      'utf8'
    )
    expect(configOf(mac)).toMatch(/^[0-9a-f]{12}$/)
    expect(configOf(other)).not.toBe(configOf(mac))
  })

  it('quotes a home folder with spaces wherever the launcher uses it', async () => {
    const launcher = await installDotnetContainerLauncher(userData, host({ home: '/Users/my dev' }))
    const script = readFileSync(launcher ?? '', 'utf8')
    expect(script).toContain("'/Users/my dev'/*|/Volumes/*) return 0 ;;")
    expect(script).toContain("--volume '/Users/my dev:/Users/my dev'")
  })

  it('mounts only the home folder on Linux', async () => {
    const script = readFileSync(
      (await installDotnetContainerLauncher(
        userData,
        host({ platform: 'linux', home: '/home/dev' })
      )) ?? '',
      'utf8'
    )
    expect(script).toContain('--volume /home/dev:/home/dev')
    expect(script).not.toContain('/Volumes')
    expect(script).toContain("orca_docker_settings=''")
  })

  it('leaves unchanged files alone so a starting run never sees a rewrite', async () => {
    const launcher = (await installDotnetContainerLauncher(userData, host())) ?? ''
    const before = statSync(launcher).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 20))
    await installDotnetContainerLauncher(userData, host())
    expect(statSync(launcher).mtimeMs).toBe(before)
  })

  it('falls back to a bare docker name when Docker is not installed yet', async () => {
    const resolveDocker = vi.fn(async () => null)
    const launcher = await installDotnetContainerLauncher(userData, host({ resolveDocker }))
    expect(readFileSync(launcher ?? '', 'utf8')).toContain('orca_docker=docker')
  })

  it('is unavailable on Windows, on other CPUs and with a home path docker cannot mount', async () => {
    expect(await installDotnetContainerLauncher(userData, host({ platform: 'win32' }))).toBeNull()
    expect(await installDotnetContainerLauncher(userData, host({ arch: 'ia32' }))).toBeNull()
    expect(await installDotnetContainerLauncher(userData, host({ home: '/Users/a:b' }))).toBeNull()
  })
})
