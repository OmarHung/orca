import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lspResultToLocations } from './lsp-locations'

const filePath = join(process.cwd(), 'src', 'lib', 'greeter.ts')
const fileUri = pathToFileURL(filePath).href
const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } }

describe('lspResultToLocations', () => {
  it('accepts a single Location', () => {
    expect(lspResultToLocations({ uri: fileUri, range })).toEqual([{ path: filePath, range }])
  })

  it('accepts a Location array', () => {
    expect(lspResultToLocations([{ uri: fileUri, range }])).toEqual([{ path: filePath, range }])
  })

  it('uses the target selection range of a LocationLink', () => {
    const wholeDeclaration = { start: { line: 3, character: 0 }, end: { line: 9, character: 1 } }
    expect(
      lspResultToLocations([
        { targetUri: fileUri, targetRange: wholeDeclaration, targetSelectionRange: range }
      ])
    ).toEqual([{ path: filePath, range }])
  })

  it('returns nothing for null', () => {
    expect(lspResultToLocations(null)).toEqual([])
  })

  it('drops non-file URIs and malformed entries', () => {
    expect(
      lspResultToLocations([
        { uri: 'csharp:/metadata/projects/App/System.Console.cs', range },
        { uri: fileUri, range: { start: { line: 1 } } },
        'nonsense',
        { uri: fileUri, range }
      ])
    ).toEqual([{ path: filePath, range }])
  })
})
