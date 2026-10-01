import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CodeNavigationRouter } from './code-navigation-routing'
import type { VueProject } from './vue-project-locator'

const repo = join('/', 'repo')
const shop = join(repo, 'shop')
const admin = join(repo, 'admin')

function router(existing: string[] = []) {
  const projectFor = vi.fn(async (path: string): Promise<VueProject | null> => {
    if (path.startsWith(shop)) {
      return { root: shop, nuxt: true }
    }
    return path.startsWith(admin) ? { root: admin, nuxt: false } : null
  })
  const invalidate = vi.fn()
  const pathExists = vi.fn(async (path: string) => existing.includes(path))
  return {
    router: new CodeNavigationRouter({ projects: { projectFor, invalidate }, pathExists }),
    projectFor,
    invalidate
  }
}

describe('CodeNavigationRouter', () => {
  it('sends TypeScript and .vue files of a Vue project to the Vue server at its package root', async () => {
    const { router: routes } = router()

    expect(await routes.route('typescript', repo, join(shop, 'app', 'stores', 'cart.ts'))).toEqual({
      kind: 'vue',
      root: shop,
      nuxt: true
    })
    expect(await routes.route('vue', repo, join(admin, 'src', 'App.vue'))).toEqual({
      kind: 'vue',
      root: admin,
      nuxt: false
    })
  })

  it('keeps other files on their own server', async () => {
    const { router: routes, projectFor } = router()

    expect(await routes.route('typescript', repo, join(repo, 'tools', 'a.ts'))).toEqual({
      kind: 'typescript',
      root: repo,
      nuxt: false
    })
    expect(await routes.route('vue', repo, join(repo, 'demo', 'A.vue'))).toEqual({
      kind: 'vue',
      root: repo,
      nuxt: false
    })
    expect(await routes.route('csharp', repo, join(repo, 'api', 'A.cs'))).toEqual({
      kind: 'csharp',
      root: repo,
      nuxt: false
    })
    expect(projectFor).toHaveBeenCalledTimes(2)
  })

  it('remembers where an open document was routed until it closes', async () => {
    const { router: routes } = router()
    const cart = join(shop, 'app', 'stores', 'cart.ts')
    await routes.route('typescript', repo, cart)

    expect(routes.closeDocument('typescript', repo, cart)).toEqual({ kind: 'vue', root: shop })
    expect(routes.closeDocument('typescript', repo, cart)).toEqual({
      kind: 'typescript',
      root: repo
    })
  })

  it('asks once per Nuxt project that lacks its generated .nuxt folder', async () => {
    const { router: routes } = router([join(admin, '.nuxt')])

    expect(await routes.needsNuxtHint({ kind: 'vue', root: shop, nuxt: true })).toBe(true)
    expect(await routes.needsNuxtHint({ kind: 'vue', root: shop, nuxt: true })).toBe(false)
    expect(await routes.needsNuxtHint({ kind: 'vue', root: admin, nuxt: false })).toBe(false)
  })

  it('rereads package.json files only after one changes', () => {
    const { router: routes, invalidate } = router()

    routes.filesChanged([{ kind: 'update', path: join(shop, 'app', 'a.ts') }])
    expect(invalidate).not.toHaveBeenCalled()
    routes.filesChanged([{ kind: 'update', path: join(shop, 'package.json') }])
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
