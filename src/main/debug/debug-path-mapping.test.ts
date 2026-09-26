import { describe, expect, it } from 'vitest'
import { DebugPathMapping } from './debug-path-mapping'

const resolve = async (path: string): Promise<string> => {
  if (path.startsWith('/missing')) {
    throw new Error('ENOENT')
  }
  return path.replace(/^\/var\//, '/private/var/')
}

describe('DebugPathMapping', () => {
  it('sends resolved breakpoint paths and maps paused frames back to the editor path', async () => {
    const mapping = new DebugPathMapping(resolve)

    const breakpoints = await mapping.breakpointsToAdapter({ '/var/w/Program.cs': [{ line: 2 }] })
    expect(breakpoints).toEqual({ '/private/var/w/Program.cs': [{ line: 2 }] })

    expect(
      mapping.responseFromAdapter('stackTrace', {
        stackFrames: [
          { id: 1, name: 'Main', line: 2, source: { path: '/private/var/w/Program.cs' } },
          { id: 2, name: 'External', line: 9 }
        ]
      })
    ).toEqual({
      stackFrames: [
        { id: 1, name: 'Main', line: 2, source: { path: '/var/w/Program.cs' } },
        { id: 2, name: 'External', line: 9 }
      ]
    })
  })

  it('translates live setBreakpoints requests and leaves other traffic alone', async () => {
    const mapping = new DebugPathMapping(resolve)

    await expect(
      mapping.requestToAdapter('setBreakpoints', {
        source: { path: '/var/w/a.cs' },
        breakpoints: [{ line: 1 }]
      })
    ).resolves.toEqual({ source: { path: '/private/var/w/a.cs' }, breakpoints: [{ line: 1 }] })
    await expect(mapping.requestToAdapter('threads', { x: 1 })).resolves.toEqual({ x: 1 })
    expect(mapping.responseFromAdapter('variables', { variables: [] })).toEqual({ variables: [] })
  })

  it('keeps paths it cannot resolve', async () => {
    const mapping = new DebugPathMapping(resolve)

    await expect(mapping.toAdapter('/missing/file.cs')).resolves.toBe('/missing/file.cs')
    expect(mapping.fromAdapter('/somewhere/else.cs')).toBe('/somewhere/else.cs')
  })
})
