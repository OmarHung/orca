import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { resolveMvcConstruct, type MvcTargetDeps } from './aspnet-mvc-targets'
import type { MvcConstruct } from './aspnet-mvc-constructs'

const root = join(process.cwd(), 'repo')
const project = join(root, 'src', 'Shop')
const file = (...parts: string[]) => join(project, ...parts)
const uri = (path: string) => pathToFileURL(path).href
const range = { start: { line: 3, character: 13 }, end: { line: 3, character: 27 } }

function deps(files: string[], symbols: Record<string, unknown[]> = {}): MvcTargetDeps {
  const existing = new Set(files)
  return {
    root,
    fileExists: async (path) => existing.has(path),
    listDir: async (dir) => (dir === project ? ['Shop.csproj', 'Program.cs'] : []),
    workspaceSymbols: vi.fn(async (query: string) => symbols[query] ?? [])
  }
}

const context = (
  controller: string | null,
  area: string | null = null,
  action: string | null = null
) => ({
  controller,
  area,
  action
})

describe('resolveMvcConstruct', () => {
  it("finds an action's own view in its controller folder, then in Shared", async () => {
    const view: MvcConstruct = {
      kind: 'view',
      name: null,
      partial: false,
      context: context('Home', null, 'Index')
    }

    expect(
      await resolveMvcConstruct(
        view,
        file('Controllers', 'HomeController.cs'),
        deps([file('Views', 'Home', 'Index.cshtml')])
      )
    ).toEqual([{ uri: uri(file('Views', 'Home', 'Index.cshtml')), range: expect.anything() }])
    expect(
      await resolveMvcConstruct(
        view,
        file('Controllers', 'HomeController.cs'),
        deps([file('Views', 'Shared', 'Index.cshtml')])
      )
    ).toEqual([{ uri: uri(file('Views', 'Shared', 'Index.cshtml')), range: expect.anything() }])
  })

  it('prefers the area views, and a partial beside the current view', async () => {
    const inArea: MvcConstruct = {
      kind: 'view',
      name: 'List',
      partial: false,
      context: context('Users', 'Admin')
    }
    const areaView = file('Areas', 'Admin', 'Views', 'Users', 'List.cshtml')
    expect(
      await resolveMvcConstruct(
        inArea,
        file('Areas', 'Admin', 'Controllers', 'UsersController.cs'),
        deps([areaView, file('Views', 'Users', 'List.cshtml')])
      )
    ).toEqual([{ uri: uri(areaView), range: expect.anything() }])

    const partial: MvcConstruct = {
      kind: 'view',
      name: '_Row',
      partial: true,
      context: context('Orders')
    }
    const beside = file('Features', 'Orders', '_Row.cshtml')
    expect(
      await resolveMvcConstruct(
        partial,
        file('Features', 'Orders', 'Index.cshtml'),
        deps([beside, file('Views', 'Shared', '_Row.cshtml')])
      )
    ).toEqual([{ uri: uri(beside), range: expect.anything() }])
  })

  it('resolves app-relative and explicit-extension view paths', async () => {
    const appRelative: MvcConstruct = {
      kind: 'view',
      name: '~/Views/Shared/_Layout.cshtml',
      partial: true,
      context: context('Home')
    }
    const layout = file('Views', 'Shared', '_Layout.cshtml')
    expect(
      await resolveMvcConstruct(appRelative, file('Views', 'Home', 'Index.cshtml'), deps([layout]))
    ).toEqual([{ uri: uri(layout), range: expect.anything() }])
  })

  it('returns nothing when no view exists or no name can be derived', async () => {
    const missing: MvcConstruct = {
      kind: 'view',
      name: 'Nope',
      partial: false,
      context: context('Home')
    }
    expect(
      await resolveMvcConstruct(missing, file('Controllers', 'HomeController.cs'), deps([]))
    ).toEqual([])
    const nameless: MvcConstruct = {
      kind: 'view',
      name: null,
      partial: false,
      context: context('Home')
    }
    expect(
      await resolveMvcConstruct(nameless, file('Controllers', 'HomeController.cs'), deps([]))
    ).toEqual([])
  })

  it('finds action overloads by csharp-ls method names, preferring the named area', async () => {
    const action: MvcConstruct = { kind: 'action', action: 'Edit', controller: 'Users', area: null }
    const main = file('Controllers', 'UsersController.cs')
    const admin = file('Areas', 'Admin', 'Controllers', 'UsersController.cs')
    const symbols = {
      Edit: [
        {
          name: 'IActionResult UsersController.Edit(int id)',
          kind: 6,
          location: { uri: uri(main), range }
        },
        {
          name: 'IActionResult UsersController.Edit(User user)',
          kind: 6,
          location: { uri: uri(main), range }
        },
        {
          name: 'IActionResult UsersController.Edit(int id)',
          kind: 6,
          location: { uri: uri(admin), range }
        },
        { name: 'void UsersControllerTests.Edit()', kind: 6, location: { uri: uri(main), range } }
      ]
    }

    expect(
      await resolveMvcConstruct(action, file('Views', 'Users', 'Index.cshtml'), deps([], symbols))
    ).toHaveLength(2)
    expect(
      await resolveMvcConstruct(
        { ...action, area: 'Admin' },
        file('Views', 'Users', 'Index.cshtml'),
        deps([], symbols)
      )
    ).toEqual([{ uri: uri(admin), range }])
  })

  it('falls back to the controller class for an action it cannot find, and needs a controller', async () => {
    const symbols = {
      Hidden: [],
      UsersController: [
        {
          name: 'UsersController',
          kind: 5,
          location: { uri: uri(file('Controllers', 'UsersController.cs')), range }
        },
        {
          name: 'UsersControllerTests',
          kind: 5,
          location: { uri: uri(file('Tests', 'T.cs')), range }
        }
      ]
    }
    expect(
      await resolveMvcConstruct(
        { kind: 'action', action: 'Hidden', controller: 'Users', area: null },
        file('Views', 'Users', 'Index.cshtml'),
        deps([], symbols)
      )
    ).toEqual([{ uri: uri(file('Controllers', 'UsersController.cs')), range }])
    expect(
      await resolveMvcConstruct(
        { kind: 'action', action: 'Index', controller: null, area: null },
        file('Views', 'Shared', '_Layout.cshtml'),
        deps([], symbols)
      )
    ).toEqual([])
  })
})
