import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { resolveNuxtLocations, withoutNuxtGeneratedLocations } from './nuxt-auto-imports'
import type { LspLocation } from './lsp-locations'

const shop = join('/', 'repo', 'shop')
const file = (...parts: string[]) => join(shop, ...parts)
const at = (path: string, line: number, character = 0): LspLocation => ({
  uri: pathToFileURL(path).href,
  range: { start: { line, character }, end: { line, character } }
})

const IMPORTS = file('.nuxt', 'types', 'imports.d.ts')
const COMPONENTS = file('.nuxt', 'components.d.ts')
const PINIA = file('node_modules', 'pinia', 'dist', 'pinia.d.ts')
const ROUTER = file('node_modules', 'nuxt', 'dist', 'app', 'composables', 'router.d.ts')

const importsText = [
  'export {}',
  'declare global {',
  "  const useCartStore: typeof import('../../app/stores/cart').useCartStore",
  "  const useToast: typeof import('../../app/composables/useToast').useToast",
  "  const navigateTo: typeof import('../../node_modules/nuxt/dist/app/composables/router').navigateTo",
  '}'
].join('\n')
const componentsText = [
  "export const LayoutAppHeader: typeof import('../app/components/layout/AppHeader.vue')['default']"
].join('\n')

function deps(definitions: Record<string, LspLocation[]>) {
  return {
    readText: vi.fn(async (path: string) =>
      path === IMPORTS ? importsText : path === COMPONENTS ? componentsText : null
    ),
    definitionAt: vi.fn(
      async (path: string, _text: string, position: { line: number; character: number }) =>
        definitions[`${path}:${position.line}:${position.character}`] ?? []
    )
  }
}

/** Where `name` after `import(...).` sits on a line of imports.d.ts, as definitionAt sees it. */
function memberKey(line: number, name: string): string {
  const text = importsText.split('\n')[line]
  return `${IMPORTS}:${line}:${text.lastIndexOf(`.${name}`) + 1}`
}

describe('resolveNuxtLocations', () => {
  it('follows an auto-import to its source and drops the library type next to it', async () => {
    const cart = at(file('app', 'stores', 'cart.ts'), 48)
    const resolveDeps = deps({ [memberKey(2, 'useCartStore')]: [cart] })

    expect(
      await resolveNuxtLocations([at(PINIA, 649), at(IMPORTS, 2, 8)], shop, resolveDeps)
    ).toEqual([cart])
  })

  it('collapses an auto-import that resolves to a location already found', async () => {
    const toast = at(file('app', 'composables', 'useToast.ts'), 13)
    const resolveDeps = deps({ [memberKey(3, 'useToast')]: [toast] })

    expect(await resolveNuxtLocations([toast, at(IMPORTS, 3, 8)], shop, resolveDeps)).toEqual([
      toast
    ])
  })

  it('keeps library results when the auto-import resolves into a library too', async () => {
    const router = at(ROUTER, 79)
    const resolveDeps = deps({ [memberKey(4, 'navigateTo')]: [router] })

    expect(await resolveNuxtLocations([at(IMPORTS, 4, 8)], shop, resolveDeps)).toEqual([router])
  })

  it("opens the component file of a components.d.ts `['default']` entry", async () => {
    expect(await resolveNuxtLocations([at(COMPONENTS, 0, 13)], shop, deps({}))).toEqual([
      at(file('app', 'components', 'layout', 'AppHeader.vue'), 0)
    ])
  })

  it('returns the locations unchanged when nothing points into .nuxt or nothing resolves', async () => {
    const plain = [at(file('app', 'utils', 'money.ts'), 3)]
    const resolveDeps = deps({})

    expect(await resolveNuxtLocations(plain, shop, resolveDeps)).toBe(plain)
    expect(resolveDeps.readText).not.toHaveBeenCalled()
    const unresolved = [at(IMPORTS, 2, 8)]
    expect(await resolveNuxtLocations(unresolved, shop, resolveDeps)).toEqual(unresolved)
  })
})

describe('withoutNuxtGeneratedLocations', () => {
  it('drops .nuxt declarations from usages unless they are all there is', () => {
    const usage = at(file('app', 'pages', 'index.vue'), 5)

    expect(withoutNuxtGeneratedLocations([usage, at(IMPORTS, 3, 8)], shop)).toEqual([usage])
    expect(withoutNuxtGeneratedLocations([at(IMPORTS, 3, 8)], shop)).toEqual([at(IMPORTS, 3, 8)])
  })
})
