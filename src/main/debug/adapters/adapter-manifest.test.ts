import { describe, expect, it } from 'vitest'
import { netcoredbgArtifactFor } from './adapter-manifest'

describe('netcoredbgArtifactFor', () => {
  it('uses 3.2 where it exists and 3.1.3 for Intel Macs', () => {
    expect(netcoredbgArtifactFor('darwin', 'arm64')?.version).toBe('3.2.0-1092')
    expect(netcoredbgArtifactFor('darwin', 'x64')?.url).toContain('3.1.3-1062/netcoredbg-osx-amd64')
    expect(netcoredbgArtifactFor('linux', 'arm64')?.url).toContain('linux-arm64')
    expect(netcoredbgArtifactFor('win32', 'x64')?.url).toContain('win64.zip')
  })

  it('has no build for Windows on Arm', () => {
    expect(netcoredbgArtifactFor('win32', 'arm64')).toBeNull()
  })
})
