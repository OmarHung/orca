/** A pinned, hash-verified download for one debug adapter. */
export type DebugAdapterArtifact = {
  name: string
  version: string
  url: string
  sha256: string
  sizeBytes: number
}

// Why the pure-Python wheel: it runs on every OS/arch and is only put on PYTHONPATH,
// so the user's environment is never modified. Hash verified against PyPI 2026-09-26.
export const DEBUGPY_ARTIFACT: DebugAdapterArtifact = {
  name: 'debugpy',
  version: '1.8.22',
  url: 'https://files.pythonhosted.org/packages/56/3d/c7dc9f35bc9e22cdb53679f844bee40fd5cff871862f60595869a433400d/debugpy-1.8.22-py2.py3-none-any.whl',
  sha256: 'a9e9d3550e15ca479c59333e90845029190531f0cacfedab3b815a57bd913947',
  sizeBytes: 5_374_857
}

// Hashes computed from the GitHub release files on 2026-09-26; releases are unsigned,
// so this manifest is what vouches for them.
export const JS_DEBUG_ARTIFACT: DebugAdapterArtifact = {
  name: 'js-debug',
  version: '1.140.0',
  url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.0/js-debug-dap-v1.140.0.tar.gz',
  sha256: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
  sizeBytes: 1_249_709
}

const NETCOREDBG_RELEASE = 'https://github.com/Samsung/netcoredbg/releases/download'

// Why two versions: 3.2 dropped Intel Mac builds, so macOS x64 stays on 3.1.3.
const NETCOREDBG_ARTIFACTS: Record<string, DebugAdapterArtifact> = {
  'darwin-arm64': {
    name: 'netcoredbg',
    version: '3.2.0-1092',
    url: `${NETCOREDBG_RELEASE}/3.2.0-1092/netcoredbg-osx-arm64.zip`,
    sha256: 'f4fa33b3ff874910cc184b4bb3b9c56d0abdf5c6521cee0b144d7c6e4a6e59ea',
    sizeBytes: 3_389_504
  },
  'darwin-x64': {
    name: 'netcoredbg',
    version: '3.1.3-1062',
    url: `${NETCOREDBG_RELEASE}/3.1.3-1062/netcoredbg-osx-amd64.tar.gz`,
    sha256: '49459b066836b6a452f418501d7ecab57bcd7e60d8464faac21ff70b496b8634',
    sizeBytes: 3_479_468
  },
  'linux-x64': {
    name: 'netcoredbg',
    version: '3.2.0-1092',
    url: `${NETCOREDBG_RELEASE}/3.2.0-1092/netcoredbg-linux-amd64.tar.gz`,
    sha256: '080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa',
    sizeBytes: 3_510_717
  },
  'linux-arm64': {
    name: 'netcoredbg',
    version: '3.2.0-1092',
    url: `${NETCOREDBG_RELEASE}/3.2.0-1092/netcoredbg-linux-arm64.tar.gz`,
    sha256: '065ff49badec8a695dbea2de6ab6a330c774a191e426a217ab8cc05250627ccb',
    sizeBytes: 3_424_271
  },
  'win32-x64': {
    name: 'netcoredbg',
    version: '3.2.0-1092',
    url: `${NETCOREDBG_RELEASE}/3.2.0-1092/netcoredbg-win64.zip`,
    sha256: '3c410a45fa502415203a94fcb88654af65bf8e3dac158a5527a722e7a6b9274a',
    sizeBytes: 3_524_161
  }
}

/** netcoredbg for this machine, or null where no build exists (e.g. Windows on Arm). */
export function netcoredbgArtifactFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): DebugAdapterArtifact | null {
  return NETCOREDBG_ARTIFACTS[`${platform}-${arch}`] ?? null
}
