import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { VueProjectLocator } from './vue-project-locator'

const repo = join('/', 'repo')
const at = (...parts: string[]) => join(repo, ...parts)

function locator(files: Record<string, unknown>) {
  const readFile = vi.fn(async (path: string) => {
    const content = files[path]
    if (content === undefined) {
      return null
    }
    return typeof content === 'string' ? content : JSON.stringify(content)
  })
  return { locator: new VueProjectLocator(readFile), readFile }
}

describe('VueProjectLocator', () => {
  it('finds the nearest package.json that depends on vue or nuxt', async () => {
    const { locator: projects } = locator({
      [at('frontend', 'admin', 'package.json')]: { dependencies: { vue: '3.5.13' } },
      [at('frontend', 'shop', 'package.json')]: { devDependencies: { nuxt: '^4.5.2' } },
      [at('ui', 'package.json')]: { peerDependencies: { vue: '^3.4.0' } }
    })

    expect(
      await projects.projectFor(at('frontend', 'admin', 'src', 'views', 'Home.vue'), repo)
    ).toEqual({ root: at('frontend', 'admin'), nuxt: false })
    expect(
      await projects.projectFor(at('frontend', 'shop', 'app', 'stores', 'cart.ts'), repo)
    ).toEqual({ root: at('frontend', 'shop'), nuxt: true })
    expect(await projects.projectFor(at('ui', 'Button.ts'), repo)).toEqual({
      root: at('ui'),
      nuxt: false
    })
  })

  it('lets the nearest package.json decide, and never looks above the workspace root', async () => {
    const { locator: projects } = locator({
      [at('package.json')]: { dependencies: { vue: '3.5.13' } },
      [at('packages', 'utils', 'package.json')]: { dependencies: { lodash: '4' } },
      [at('packages', 'broken', 'package.json')]: '{ not json',
      [join('/', 'package.json')]: { dependencies: { vue: '3.5.13' } }
    })

    expect(await projects.projectFor(at('packages', 'utils', 'src', 'a.ts'), repo)).toBeNull()
    expect(await projects.projectFor(at('packages', 'broken', 'a.ts'), repo)).toBeNull()
    expect(await projects.projectFor(at('scripts', 'build.ts'), repo)).toEqual({
      root: repo,
      nuxt: false
    })
    expect(await projects.projectFor(at('backend', 'tool.ts'), at('backend'))).toBeNull()
  })

  it('reads each package.json once until invalidated', async () => {
    const { locator: projects, readFile } = locator({
      [at('package.json')]: { dependencies: { vue: '3.5.13' } }
    })

    await projects.projectFor(at('src', 'a.ts'), repo)
    await projects.projectFor(at('src', 'b.ts'), repo)
    const reads = readFile.mock.calls.length
    projects.invalidate()
    await projects.projectFor(at('src', 'a.ts'), repo)

    expect(readFile.mock.calls.filter(([path]) => path === at('src', 'package.json'))).toHaveLength(
      2
    )
    expect(readFile.mock.calls.length).toBe(reads * 2)
  })
})
