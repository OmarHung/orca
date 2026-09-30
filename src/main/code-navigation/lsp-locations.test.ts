import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filePathFromUri, lspResultToLocations } from './lsp-locations'

const filePath = join(process.cwd(), 'src', 'lib', 'greeter.ts')
const fileUri = pathToFileURL(filePath).href
const metadataUri = 'csharp:/repo/App/App.csproj/decompiled/System.Console.cs'
const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } }

describe('lspResultToLocations', () => {
  it('accepts a single Location', () => {
    expect(lspResultToLocations({ uri: fileUri, range })).toEqual([{ uri: fileUri, range }])
  })

  it('accepts a Location array and keeps every scheme', () => {
    expect(
      lspResultToLocations([
        { uri: fileUri, range },
        { uri: metadataUri, range }
      ])
    ).toEqual([
      { uri: fileUri, range },
      { uri: metadataUri, range }
    ])
  })

  it('uses the target selection range of a LocationLink', () => {
    const wholeDeclaration = { start: { line: 3, character: 0 }, end: { line: 9, character: 1 } }
    expect(
      lspResultToLocations([
        { targetUri: fileUri, targetRange: wholeDeclaration, targetSelectionRange: range }
      ])
    ).toEqual([{ uri: fileUri, range }])
  })

  it('returns nothing for null and skips malformed entries', () => {
    expect(lspResultToLocations(null)).toEqual([])
    expect(
      lspResultToLocations([
        { uri: fileUri, range: { start: { line: 1 } } },
        'nonsense',
        { range },
        { uri: fileUri, range }
      ])
    ).toEqual([{ uri: fileUri, range }])
  })
})

describe('filePathFromUri', () => {
  it('maps file URIs to paths and rejects other schemes', () => {
    expect(filePathFromUri(fileUri)).toBe(filePath)
    expect(filePathFromUri(metadataUri)).toBeNull()
  })
})
