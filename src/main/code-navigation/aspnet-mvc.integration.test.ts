import { mkdirSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { CodeNavigationService } from './code-navigation-service'
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

let root = ''
let service: CodeNavigationService

/** Where the `|` marks the cursor in `marked`, as a definition query on the file. */
function definitionAt(
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
    root,
    feature,
    document: {
      path: join(root, relativePath),
      languageId: relativePath.endsWith('.cshtml') ? 'razor' : 'csharp',
      version: 1,
      // Monaco drops the BOM from the text it hands Orca.
      text: text.replace(/^﻿/, '')
    },
    position: {
      line: before.length - 1,
      character: before.at(-1)!.replace(/^﻿/, '').length
    }
  }
}

async function targetOf(query: CodeNavigationQuery) {
  const result = await service.query(query, () => {})
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.locations.map((location) => ({
    file: location.path.slice(root.length + 1).replace(/\\/g, '/'),
    line: location.range.start.line
  }))
}

describe.skipIf(!csharpLsDll)('ASP.NET MVC navigation against csharp-ls', () => {
  beforeAll(async () => {
    const dotnet = await resolveCommandOnLocalPath('dotnet')
    root = await realpath(await mkdtemp(join(tmpdir(), 'orca-mvc-it-')))
    await runProcess({
      program: dotnet!,
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
    service = new CodeNavigationService({
      prepareLaunch: async () => ({
        program: dotnet!,
        args: [csharpLsDll!, '--features', 'razor-support'],
        env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major', UseRazorSourceGenerator: 'true' },
        configuration: { csharp: { useMetadataUris: true } }
      }),
      isInstalled: async () => true
    })
  }, 300_000)

  afterAll(async () => {
    await service?.disposeAll()
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('follows tag helpers and partials in a view, and the C# inside it', async () => {
    const view = 'Views/Orders/Index.cshtml'
    expect(await targetOf(definitionAt(view, ORDERS_INDEX, 'asp-action="Priv|acy"'))).toEqual([
      { file: 'Controllers/HomeController.cs', line: expect.any(Number) }
    ])
    expect(await targetOf(definitionAt(view, ORDERS_INDEX, 'asp-controller="Ho|me"'))).toEqual([
      { file: 'Controllers/HomeController.cs', line: expect.any(Number) }
    ])
    expect(await targetOf(definitionAt(view, ORDERS_INDEX, 'name="_R|ow"'))).toEqual([
      { file: 'Views/Shared/_Row.cshtml', line: 0 }
    ])
    expect(await targetOf(definitionAt(view, ORDERS_INDEX, '@Model.Request|Id'))).toEqual([
      { file: 'Models/ErrorViewModel.cs', line: expect.any(Number) }
    ])
    const usages = await targetOf(
      definitionAt(view, ORDERS_INDEX, '@Model.Request|Id', 'references')
    )
    expect(usages.map((usage) => usage.file)).toEqual(
      expect.arrayContaining(['Models/ErrorViewModel.cs', 'Views/Shared/Error.cshtml'])
    )
  }, 180_000)

  it('follows View() and RedirectToAction in a controller', async () => {
    const controller = 'Controllers/OrdersController.cs'
    const at = (marker: string) => targetOf(definitionAt(controller, ORDERS_CONTROLLER, marker))
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
