import type { DebugAdapterArtifact } from '../debug/adapters/adapter-manifest'

const TYPESCRIPT_VERSION = '7.0.2'
const NPM_REGISTRY = 'https://registry.npmjs.org/@typescript'

function typescriptArtifact(
  target: string,
  sha256: string,
  sizeBytes: number
): DebugAdapterArtifact {
  return {
    name: 'typescript-native',
    version: TYPESCRIPT_VERSION,
    url: `${NPM_REGISTRY}/typescript-${target}/-/typescript-${target}-${TYPESCRIPT_VERSION}.tgz`,
    sha256,
    sizeBytes
  }
}

// Why TypeScript 7: its native `tsc --lsp --stdio` is a standard LSP server with no Node runtime.
// Hashes computed 2026-09-30 and checked against each package's npm sha512 integrity.
const TYPESCRIPT_ARTIFACTS: Record<string, DebugAdapterArtifact> = {
  'darwin-arm64': typescriptArtifact(
    'darwin-arm64',
    '902e2fe1cf0799198ef902c6b8c310a450fef629a6baba41d45641ef75c04ebd',
    9_270_373
  ),
  'darwin-x64': typescriptArtifact(
    'darwin-x64',
    'eba158cb54050f723d5ff781438f33de5640054440bb4f2bd170cfe9bc2eb551',
    10_057_523
  ),
  'linux-x64': typescriptArtifact(
    'linux-x64',
    '7ecad6f67377e831856367ab062ef394f21506a611405bf8ac0ff039348637d3',
    9_669_334
  ),
  'linux-arm64': typescriptArtifact(
    'linux-arm64',
    'c83d931ac9dd7549cde6e71246aa9d6a9812843023df3e277fe3b5dcf41dd0ea',
    8_900_516
  ),
  'win32-x64': typescriptArtifact(
    'win32-x64',
    '61fc4e141d2bc687db580e71bbfa63b9c209f0310645d82ca1b457eb3a24fd19',
    9_776_626
  ),
  'win32-arm64': typescriptArtifact(
    'win32-arm64',
    '0a73534e6ee50cdbb2a29ac48657ca0ad13cf0f424cf63808e4df7baeb87b8be',
    8_900_840
  )
}

/** The native TypeScript server for this machine, or null where no build exists. */
export function typescriptServerArtifactFor(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): DebugAdapterArtifact | null {
  return TYPESCRIPT_ARTIFACTS[`${platform}-${arch}`] ?? null
}

// Why csharp-ls over Roslyn's own server: Roslyn's is not on nuget.org and its public feed lags
// VS Code's build by months; csharp-ls is Roslyn-based, MIT, and nuget.org never deletes packages.
// The .nupkg is framework-dependent, so one download serves every OS. Hash checked against the
// NuGet catalog's SHA-512 on 2026-09-30.
export const CSHARP_SERVER_ARTIFACT: DebugAdapterArtifact = {
  name: 'csharp-ls',
  version: '0.28.0',
  url: 'https://api.nuget.org/v3-flatcontainer/csharp-ls/0.28.0/csharp-ls.0.28.0.nupkg',
  sha256: '8f815e4f22674106a8244beba07e4b4b062e31528e404aa8489312effb8c0e0c',
  sizeBytes: 21_643_814
}

/** Where csharp-ls keeps its entry assembly inside the extracted package. */
export const CSHARP_SERVER_ENTRY = ['tools', 'net10.0', 'any', 'CSharpLanguageServer.dll'] as const
