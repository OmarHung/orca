import { readFile, stat } from 'node:fs/promises'
import type { CodeNavigationLocation } from '../../shared/code-navigation/code-navigation-types'
import { filePathFromUri, type LspLocation } from './lsp-locations'
import { CSHARP_METADATA_URI_PREFIX } from './csharp-metadata-files'

const MAX_PREVIEW_FILES = 100
const MAX_PREVIEW_BYTES = 1024 * 1024

/** Writes a `csharp:` URI's decompiled source to a file and returns its path. */
export type MetadataFileResolver = (uri: string) => Promise<string | null>

/**
 * Maps server locations to files Orca can open: `file:` URIs directly, decompiled C# through
 * `resolveMetadata`. Anything else (and metadata that fails to resolve) is dropped.
 */
export async function toFileLocations(
  locations: readonly LspLocation[],
  resolveMetadata: MetadataFileResolver | null
): Promise<CodeNavigationLocation[]> {
  const metadataPaths = new Map<string, Promise<string | null>>()
  const metadataPath = (uri: string): Promise<string | null> => {
    const pending =
      metadataPaths.get(uri) ?? resolveMetadata?.(uri).catch(() => null) ?? Promise.resolve(null)
    metadataPaths.set(uri, pending)
    return pending
  }
  const resolved = await Promise.all(
    locations.map(async (location) => {
      const path =
        filePathFromUri(location.uri) ??
        (location.uri.startsWith(CSHARP_METADATA_URI_PREFIX)
          ? await metadataPath(location.uri)
          : null)
      return path ? { path, range: location.range } : null
    })
  )
  return resolved.filter((location): location is CodeNavigationLocation => location !== null)
}

export async function readPreviewFile(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_PREVIEW_BYTES) {
      return null
    }
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** File text for every target other than the queried document, so peek can preview them. */
export async function readTargetPreviews(
  locations: readonly CodeNavigationLocation[],
  queriedPath: string,
  read: (path: string) => Promise<string | null> = readPreviewFile
): Promise<Record<string, string>> {
  const paths = [...new Set(locations.map((location) => location.path))]
    .filter((path) => path !== queriedPath)
    .slice(0, MAX_PREVIEW_FILES)
  const contents = await Promise.all(paths.map(async (path) => [path, await read(path)] as const))
  return Object.fromEntries(
    contents.filter((entry): entry is readonly [string, string] => entry[1] !== null)
  )
}
