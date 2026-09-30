import { mkdirSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { CodeNavigationService } from './code-navigation-service'
import { ensureCsharpRazorDesignTimeTargets } from './csharp-razor-design-time'
import type { CodeNavigationQuery } from '../../shared/code-navigation/code-navigation-types'

// Opt-in: point at an extracted csharp-ls (tools/net10.0/any/CSharpLanguageServer.dll).
const csharpLsDll = process.env.ORCA_TEST_CSHARP_LS_DLL

const ORDERS_CONTROLLER = `using Microsoft.AspNetCore.Mvc;

namespace Shop.Controllers;

public class OrdersController : Controller
{
    public IActionResult Index()
    {
        return View();
    }

    public IActionResult Details(int id)
    {
        return View("Show");
    }

    [ActionName("Archive")]
    public IActionResult Old()
    {
        return View();
    }

    public IActionResult Create()
    {
        return RedirectToAction("Index", "Home");
    }
}
`

// Why a BOM: Visual Studio and dotnet new save views with one.
const ORDERS_INDEX = `﻿@model Shop.Models.ErrorViewModel
<a asp-controller="Home" asp-action="Privacy">Privacy</a>
<partial name="_Row" />
<p>@Model.RequestId</p>
`

type Project = { root: string; service: CodeNavigationService }

/** Where the `|` marks the cursor in `marked`, as a definition query on the file. */
function definitionAt(
  project: Project,
  relativePath: string,
  text: string,
  marker: string,
  feature: CodeNavigationQuery['feature'] = 'definition'
): CodeNavigationQuery {
  const offset = text.indexOf(marker.replace('|', ''))
  const cursor = offset + marker.indexOf('|')
  const before = text.slice(0, cursor).split('\n')
  return {
    kind: 'csharp',
    root: project.root,
    feature,
    document: {
      path: join(project.root, relativePath),
      languageId: relativePath.endsWith('.cshtml') ? 'razor' : 'csharp',
      version: 1,
      // Monaco drops the BOM from the text it hands Orca.
      text: text.replace(/^\uFEFF/, '')
    },
    position: {
      line: before.length - 1,
      character: before.at(-1)!.replace(/^\uFEFF/, '').length
    }
  }
}

async function targetOf(project: Project, query: CodeNavigationQuery) {
  const result = await project.service.query(query, () => {})
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.locations.map((location) => ({
    file: location.path.slice(project.root.length + 1).replace(/\\/g, '/'),
    line: location.range.start.line
  }))
}

/** A temp project, set up by `create`, served by csharp-ls launched like Orca launches it. */
async function startProject(create: (root: string, dotnet: string) => Promise<void>) {
  const dotnet = (await resolveCommandOnLocalPath('dotnet'))!
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-mvc-it-')))
  await create(root, dotnet)
  const targets = await ensureCsharpRazorDesignTimeTargets(join(root, '.orca-test'))
  const service = new CodeNavigationService({
    prepareLaunch: async () => ({
      program: dotnet,
      args: [csharpLsDll!, '--features', 'razor-support'],
      env: {
        ...process.env,
        DOTNET_ROLL_FORWARD: 'Major',
        UseRazorSourceGenerator: 'true',
        CustomAfterMicrosoftCommonTargets: targets
      },
      configuration: { csharp: { useMetadataUris: true } }
    }),
    isInstalled: async () => true
  })
  return { root, service }
}

async function stopProject(project: Project | undefined) {
  await project?.service.disposeAll()
  if (project) {
    await rm(project.root, { recursive: true, force: true })
  }
}

describe.skipIf(!csharpLsDll)('ASP.NET MVC navigation against csharp-ls', () => {
  let project: Project
  const definition = (path: string, text: string, marker: string) =>
    targetOf(project, definitionAt(project, path, text, marker))

  beforeAll(async () => {
    project = await startProject(async (root, dotnet) => {
      await runProcess({
        program: dotnet,
        args: ['new', 'mvc', '-n', 'Shop', '-o', root, '--force'],
        cwd: root,
        timeoutMs: 180_000
      })
      mkdirSync(join(root, 'Views', 'Orders'), { recursive: true })
      await writeFile(join(root, 'Controllers', 'OrdersController.cs'), ORDERS_CONTROLLER)
      await writeFile(join(root, 'Views', 'Orders', 'Index.cshtml'), ORDERS_INDEX)
      await writeFile(join(root, 'Views', 'Orders', 'Show.cshtml'), '<h1>Show</h1>\n')
      await writeFile(join(root, 'Views', 'Orders', 'Archive.cshtml'), '<h1>Archive</h1>\n')
      await writeFile(join(root, 'Views', 'Shared', '_Row.cshtml'), '<tr></tr>\n')
    })
  }, 300_000)

  afterAll(() => stopProject(project))

  it('follows tag helpers and partials in a view, and the C# inside it', async () => {
    const view = 'Views/Orders/Index.cshtml'
    expect(await definition(view, ORDERS_INDEX, 'asp-action="Priv|acy"')).toEqual([
      { file: 'Controllers/HomeController.cs', line: expect.any(Number) }
    ])
    expect(await definition(view, ORDERS_INDEX, 'asp-controller="Ho|me"')).toEqual([
      { file: 'Controllers/HomeController.cs', line: expect.any(Number) }
    ])
    expect(await definition(view, ORDERS_INDEX, 'name="_R|ow"')).toEqual([
      { file: 'Views/Shared/_Row.cshtml', line: 0 }
    ])
    expect(await definition(view, ORDERS_INDEX, '@Model.Request|Id')).toEqual([
      { file: 'Models/ErrorViewModel.cs', line: expect.any(Number) }
    ])
    const usages = await targetOf(
      project,
      definitionAt(project, view, ORDERS_INDEX, '@Model.Request|Id', 'references')
    )
    expect(usages.map((usage) => usage.file)).toEqual(
      expect.arrayContaining(['Models/ErrorViewModel.cs', 'Views/Shared/Error.cshtml'])
    )
  }, 180_000)

  it('follows View() and RedirectToAction in a controller', async () => {
    const controller = 'Controllers/OrdersController.cs'
    const at = (marker: string) => definition(controller, ORDERS_CONTROLLER, marker)
    expect(await at('return Vi|ew();\n    }\n\n    public IActionResult Details')).toEqual([
      { file: 'Views/Orders/Index.cshtml', line: 0 }
    ])
    expect(await at('View("Sh|ow")')).toEqual([{ file: 'Views/Orders/Show.cshtml', line: 0 }])
    expect(await at('return Vi|ew();\n    }\n\n    public IActionResult Create')).toEqual([
      { file: 'Views/Orders/Archive.cshtml', line: 0 }
    ])
    expect(await at('RedirectToAction("Ind|ex", "Home")')).toEqual([
      { file: 'Controllers/HomeController.cs', line: expect.any(Number) }
    ])
  }, 180_000)
})

const LEGACY_PROJECT = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>netcoreapp3.1</TargetFramework>
  </PropertyGroup>
</Project>
`

const LEGACY_VIEW = `@model Legacy.Models.Order
<p>@Model.Total</p>
`

// Opt-in twice over: also needs the netcoreapp3.1 reference packs, which newer SDKs don't ship.
describe.skipIf(!csharpLsDll || !process.env.ORCA_TEST_NETCOREAPP31)(
  'Razor views of a netcoreapp3.1 project against csharp-ls',
  () => {
    let project: Project

    beforeAll(async () => {
      project = await startProject(async (root, dotnet) => {
        mkdirSync(join(root, 'Models'), { recursive: true })
        mkdirSync(join(root, 'Views', 'Orders'), { recursive: true })
        await writeFile(join(root, 'Legacy.csproj'), LEGACY_PROJECT)
        await writeFile(
          join(root, 'Program.cs'),
          'namespace Legacy { public static class Program { public static void Main() { } } }\n'
        )
        await writeFile(
          join(root, 'Models', 'Order.cs'),
          'namespace Legacy.Models { public class Order { public decimal Total { get; set; } } }\n'
        )
        await writeFile(join(root, 'Views', 'Orders', 'Index.cshtml'), LEGACY_VIEW)
        await runProcess({ program: dotnet, args: ['restore'], cwd: root, timeoutMs: 180_000 })
      })
    }, 300_000)

    afterAll(() => stopProject(project))

    it('resolves @model and Model members, which the SDK leaves ungenerated there', async () => {
      const view = 'Views/Orders/Index.cshtml'
      const at = (marker: string) =>
        targetOf(project, definitionAt(project, view, LEGACY_VIEW, marker))
      expect(await at('Legacy.Models.Ord|er')).toEqual([{ file: 'Models/Order.cs', line: 0 }])
      expect(await at('@Model.To|tal')).toEqual([{ file: 'Models/Order.cs', line: 0 }])
    }, 180_000)
  }
)
