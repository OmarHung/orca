import { describe, expect, it } from 'vitest'
// The same module the public `monaco.Uri` re-exports, without loading the editor bundle.
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js'
import { CodeNavigationActivation } from './code-navigation-activation'

const model = (path: string) => ({ uri: URI.file(path) })
const editor = (path: string) => ({ getModel: () => model(path) })

describe('CodeNavigationActivation', () => {
  it('consumes a matching user action once', () => {
    const activation = new CodeNavigationActivation()
    activation.arm(editor('/repo/app.ts'), 'definition', 1_000)

    expect(activation.consume(model('/repo/app.ts'), 'implementation', 1_001)).toBe(false)
    expect(activation.consume(model('/repo/app.ts'), 'definition', 1_001)).toBe(true)
    expect(activation.consume(model('/repo/app.ts'), 'definition', 1_001)).toBe(false)
  })

  it('rejects an expired action and tracks activated workspaces by kind and root', () => {
    const activation = new CodeNavigationActivation()
    activation.arm(editor('/repo/app.ts'), 'definition', 1_000)

    expect(activation.consume(model('/repo/app.ts'), 'definition', 2_001)).toBe(false)
    expect(activation.isWorkspaceActivated('csharp', '/repo')).toBe(false)
    activation.activateWorkspace('csharp', '/repo')
    expect(activation.isWorkspaceActivated('csharp', '/repo')).toBe(true)
    expect(activation.isWorkspaceActivated('typescript', '/repo')).toBe(false)
  })
})
