import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** csharp-ls's scheme for decompiled framework and package sources. */
export const CSHARP_METADATA_URI_PREFIX = 'csharp:'

const MAX_NAME_CHARS = 120

type MetadataSource = { assemblyName: string; symbolName: string; source: string }

function isMetadataSource(value: unknown): value is MetadataSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'assemblyName' in value &&
    typeof value.assemblyName === 'string' &&
    'symbolName' in value &&
    typeof value.symbolName === 'string' &&
    'source' in value &&
    typeof value.source === 'string'
  )
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]/g, '_').slice(0, MAX_NAME_CHARS) || 'metadata'
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes the decompiled source behind a `csharp:` URI to a read-only file, so it opens in an
 * ordinary editor tab, and returns that file's path. Null when the server has no source for it.
 */
export async function writeCsharpMetadataFile(
  cacheDir: string,
  uri: string,
  request: (method: string, params: unknown) => Promise<unknown>
): Promise<string | null> {
  const metadata = await request('csharp/metadata', { textDocument: { uri } })
  if (!isMetadataSource(metadata)) {
    return null
  }
  // Why the URI hash: one assembly name can mean different versions in different projects.
  const hash = createHash('sha256').update(uri).digest('hex').slice(0, 10)
  const dir = join(cacheDir, `${safeName(metadata.assemblyName)}-${hash}`)
  const path = join(dir, `${safeName(metadata.symbolName)}.cs`)
  // Why skip identical content: rewriting would flag an open tab as changed on disk.
  if ((await readIfPresent(path)) === metadata.source) {
    return path
  }
  await mkdir(dir, { recursive: true })
  // Why chmod first: the previous copy is read-only, which blocks deleting it on Windows.
  await chmod(path, 0o644).catch(() => {})
  await rm(path, { force: true })
  await writeFile(path, metadata.source, { mode: 0o444 })
  return path
}
