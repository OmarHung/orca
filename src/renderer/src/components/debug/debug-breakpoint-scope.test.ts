import { describe, expect, it } from 'vitest'
import { isInDebugScope, mergeVerifiedLines } from './debug-breakpoint-scope'

describe('isInDebugScope', () => {
  it("takes files under the workspace in the adapter's languages", () => {
    const dotnet = { rootPath: '/repo', adapterId: 'coreclr' }
    expect(isInDebugScope(dotnet, '/repo/Api/BannersController.cs')).toBe(true)
    expect(isInDebugScope(dotnet, '/repo/tools/keylevel_server.py')).toBe(false)
    expect(isInDebugScope(dotnet, '/other/Api/Startup.cs')).toBe(false)
  })

  it('takes every language without an adapter', () => {
    const workspace = { rootPath: '/repo' }
    expect(isInDebugScope(workspace, '/repo/tools/keylevel_server.py')).toBe(true)
    expect(isInDebugScope(workspace, '/repo-copy/a.py')).toBe(false)
  })

  it('treats TypeScript and Vue as Node sources', () => {
    const node = { rootPath: '/repo', adapterId: 'pwa-node' }
    expect(isInDebugScope(node, '/repo/web/src/App.vue')).toBe(true)
    expect(isInDebugScope(node, '/repo/web/src/main.TS')).toBe(true)
    expect(isInDebugScope(node, '/repo/web/README.md')).toBe(false)
  })
})

describe('mergeVerifiedLines', () => {
  it('counts a line as bound when any session bound it', () => {
    expect(mergeVerifiedLines([{ 3: false, 5: true }, undefined, { 3: true }])).toEqual({
      3: true,
      5: true
    })
  })

  it('knows nothing until a session answered', () => {
    expect(mergeVerifiedLines([undefined])).toBeUndefined()
    expect(mergeVerifiedLines([])).toBeUndefined()
  })
})
