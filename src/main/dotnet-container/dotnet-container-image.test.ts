import { describe, expect, it } from 'vitest'
import { DOTNET_CONTAINER_DOWNLOADS } from './dotnet-container-downloads'
import { buildDotnetContainerDockerfile, dotnetContainerImageTag } from './dotnet-container-image'

function decodedFiles(dockerfile: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const match of dockerfile.matchAll(/echo ([A-Za-z0-9+/=]+) \| base64 -d > (\S+)/g)) {
    files[match[2]] = Buffer.from(match[1], 'base64').toString('utf8')
  }
  return files
}

describe('buildDotnetContainerDockerfile', () => {
  it('verifies every pinned download and unpacks SDK 10 last so its dotnet host wins', () => {
    const dockerfile = buildDotnetContainerDockerfile('arm64')
    const downloads = DOTNET_CONTAINER_DOWNLOADS.arm64
    for (const download of downloads) {
      expect(dockerfile).toContain(download.url)
      expect(dockerfile).toContain(`echo "${download.sha512}  /tmp/dotnet.tgz" | sha512sum -c -`)
    }
    const positions = downloads.map((download) => dockerfile.indexOf(download.url))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(downloads.at(-1)?.name).toBe('SDK 10.0.201')
  })

  it('bakes in the netcoredbg build that runs on its base image, verified', () => {
    const dockerfile = buildDotnetContainerDockerfile('arm64')
    expect(dockerfile).toContain('3.1.0-1031/netcoredbg-linux-arm64.tar.gz')
    expect(dockerfile).toContain(
      'echo "2419a6b34c7d25541a4bca9f140c137bdd6f6a3b5693d2f79bc04c930061ffa3  /tmp/netcoredbg.tgz" | sha256sum -c -'
    )
    expect(dockerfile).toContain('tar -xzf /tmp/netcoredbg.tgz -C /usr/local/lib')
  })

  it('uses the x64 archives for an x64 host', () => {
    const dockerfile = buildDotnetContainerDockerfile('x64')
    expect(dockerfile).toContain('dotnet-sdk-10.0.201-linux-x64.tar.gz')
    expect(dockerfile).not.toContain('linux-arm64')
  })

  it('bakes in orca-exec, the IPv4 shim source and the legacy ASP.NET targets', () => {
    const files = decodedFiles(buildDotnetContainerDockerfile('arm64'))
    expect(files['/usr/local/bin/orca-exec']).toContain('orca-exec --kill RUN_ID')
    expect(files['/usr/local/bin/orca-exec']).toContain('orca-exec --list')
    expect(files['/usr/local/bin/orca-exec']).toContain('orca-exec --ports')
    expect(files['/tmp/orca-ipv4only.c']).toContain(
      'domain == AF_INET6 && (type & 0xf) == SOCK_DGRAM'
    )
    expect(files['/usr/local/share/orca/orca-legacy-aspnet.targets']).toContain(
      "'$(_IsPublishing)' != 'true'"
    )
  })

  it('sets the environment that routes 2.x apps to 3.1 and keeps the CLI out of the Mac home', () => {
    const dockerfile = buildDotnetContainerDockerfile('arm64')
    expect(dockerfile).toContain('DOTNET_ROLL_FORWARD=Major')
    expect(dockerfile).toContain(
      'AfterMicrosoftNETSdkTargets=/usr/local/share/orca/orca-legacy-aspnet.targets'
    )
    expect(dockerfile).toContain('LD_PRELOAD=/usr/local/lib/orca-ipv4only.so')
    expect(dockerfile).toContain('DOTNET_CLI_HOME=/var/lib/orca-dotnet')
  })
})

describe('dotnetContainerImageTag', () => {
  it('is stable for the same Dockerfile and changes with it', () => {
    const arm = buildDotnetContainerDockerfile('arm64')
    expect(dotnetContainerImageTag(arm)).toBe(dotnetContainerImageTag(arm))
    expect(dotnetContainerImageTag(arm)).toMatch(/^orca-dotnet:[0-9a-f]{12}$/)
    expect(dotnetContainerImageTag(buildDotnetContainerDockerfile('x64'))).not.toBe(
      dotnetContainerImageTag(arm)
    )
  })
})
