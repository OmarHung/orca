import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeCsharpMetadataFile } from './csharp-metadata-files'

const URI = 'csharp:/repo/App/App.csproj/decompiled/System.Console.cs'
let cacheDir: string

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'orca-csharp-metadata-'))
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

function metadata(source: string, symbolName = 'System.Console') {
  return vi.fn(async () => ({
    projectName: 'App',
    assemblyName: 'System.Console',
    symbolName,
    source
  }))
}

describe('writeCsharpMetadataFile', () => {
  it('writes the decompiled source to a read-only file named after the symbol', async () => {
    const request = metadata('public static class Console {}')

    const path = await writeCsharpMetadataFile(cacheDir, URI, request)

    expect(request).toHaveBeenCalledWith('csharp/metadata', { textDocument: { uri: URI } })
    expect(path).toMatch(/System\.Console-[0-9a-f]{10}[\\/]System\.Console\.cs$/)
    expect(await readFile(path!, 'utf8')).toBe('public static class Console {}')
    if (process.platform !== 'win32') {
      expect((await stat(path!)).mode & 0o222).toBe(0)
    }
  })

  it('replaces a changed read-only copy but leaves an identical one alone', async () => {
    const first = await writeCsharpMetadataFile(cacheDir, URI, metadata('v1'))
    const firstWrite = (await stat(first!)).mtimeMs

    await writeCsharpMetadataFile(cacheDir, URI, metadata('v1'))
    expect((await stat(first!)).mtimeMs).toBe(firstWrite)

    const second = await writeCsharpMetadataFile(cacheDir, URI, metadata('v2'))
    expect(second).toBe(first)
    expect(await readFile(second!, 'utf8')).toBe('v2')
  })

  it('keeps names inside the cache directory and returns null without a source', async () => {
    const path = await writeCsharpMetadataFile(cacheDir, URI, metadata('x', '../../evil'))
    expect(path!.startsWith(cacheDir)).toBe(true)
    expect(path).toMatch(/\.\._\.\._evil\.cs$/)
    expect(
      await writeCsharpMetadataFile(
        cacheDir,
        URI,
        vi.fn(async () => null)
      )
    ).toBeNull()
  })
})

describe('isCodeNavigationMetadataPath', () => {
  it('recognizes decompiled files on every platform and nothing else', async () => {
    const { isCodeNavigationMetadataPath } =
      await import('../../shared/code-navigation/code-navigation-types')
    expect(
      isCodeNavigationMetadataPath(
        '/Users/me/Library/Application Support/orca/language-servers/csharp-metadata/A-1/A.cs'
      )
    ).toBe(true)
    expect(
      isCodeNavigationMetadataPath(
        'C:\\Users\\me\\AppData\\Roaming\\orca\\language-servers\\csharp-metadata\\A-1\\A.cs'
      )
    ).toBe(true)
    expect(isCodeNavigationMetadataPath('/repo/csharp-metadata/A.cs')).toBe(false)
  })
})
