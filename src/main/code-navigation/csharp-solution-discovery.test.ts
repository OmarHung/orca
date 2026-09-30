import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findCsharpSolution, type ReadDirectory } from './csharp-solution-discovery'

const root = join(process.cwd(), 'repo')

/** A fake tree: directories end with '/', everything else is a file. */
function tree(paths: string[]): ReadDirectory {
  return async (directory) => {
    const prefix = directory === root ? '' : `${directory.slice(root.length + 1)}/`
    const names = new Map<string, boolean>()
    for (const path of paths) {
      if (!path.startsWith(prefix)) {
        continue
      }
      const [head, ...rest] = path.slice(prefix.length).split('/')
      if (head) {
        names.set(head, rest.length > 0 || path.endsWith('/'))
      }
    }
    return [...names].map(([name, isDirectory]) => ({ name, isDirectory }))
  }
}

describe('findCsharpSolution', () => {
  it('finds a solution below the root, skipping dependency folders', async () => {
    const read = tree([
      'frontend/node_modules/pkg/Other.sln',
      'backend/EcommerceApi.sln',
      'backend/src/EcommerceApi/EcommerceApi.csproj'
    ])
    expect(await findCsharpSolution(root, read)).toBe(join('backend', 'EcommerceApi.sln'))
  })

  it('prefers the shallowest solution and accepts .slnx', async () => {
    expect(await findCsharpSolution(root, tree(['App.slnx', 'tools/Tools.sln']))).toBe('App.slnx')
  })

  it('leaves the choice to csharp-ls when one depth has several solutions or none exist', async () => {
    expect(await findCsharpSolution(root, tree(['A.sln', 'B.sln']))).toBeNull()
    expect(await findCsharpSolution(root, tree(['src/App/App.csproj']))).toBeNull()
  })
})
