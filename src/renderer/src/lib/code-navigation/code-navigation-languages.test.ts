import { describe, expect, it } from 'vitest'
import { codeNavigationLanguageForPath } from './code-navigation-languages'

describe('codeNavigationLanguageForPath', () => {
  it.each([
    ['/repo/src/app.ts', 'typescript', 'typescript'],
    ['/repo/src/App.TSX', 'typescript', 'typescriptreact'],
    ['/repo/lib/index.mjs', 'typescript', 'javascript'],
    ['/repo/web/Button.jsx', 'typescript', 'javascriptreact'],
    ['C:\\repo\\App\\Program.cs', 'csharp', 'csharp']
  ])('maps %s to the %s server as %s', (path, kind, languageId) => {
    expect(codeNavigationLanguageForPath(path)).toEqual({ kind, languageId })
  })

  it.each(['/repo/README.md', '/repo/.ts', '/repo/Makefile', '/repo.cs/notes'])(
    'ignores %s',
    (path) => {
      expect(codeNavigationLanguageForPath(path)).toBeNull()
    }
  )
})
