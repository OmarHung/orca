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
