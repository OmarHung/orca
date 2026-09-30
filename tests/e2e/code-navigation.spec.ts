import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

// Opt-in: the first jump downloads the language servers from npm and nuget.org.
const RUN = process.env.ORCA_E2E_CODE_NAVIGATION === '1'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const BACK = process.platform === 'darwin' ? 'Meta+BracketLeft' : 'Control+Alt+ArrowLeft'
const FORWARD = process.platform === 'darwin' ? 'Meta+BracketRight' : 'Control+Alt+ArrowRight'
const WORD_RIGHT = process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight'
const SCREENSHOT_DIR = process.env.ORCA_E2E_CODE_NAVIGATION_SCREENSHOTS

function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function openEditorFile(page: Page, root: string, relativePath: string, language: string) {
  await page.evaluate(
    ({ root: rootPath, rel, lang }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (!state || !worktreeId) {
        throw new Error('no active worktree')
      }
      const separator = rootPath.includes('\\') ? '\\' : '/'
      state.openFile({
        filePath: `${rootPath}${separator}${rel.split('/').join(separator)}`,
        relativePath: rel,
        worktreeId,
        language: lang,
        mode: 'edit'
      })
    },
    { root, rel: relativePath, lang: language }
  )
}

/** Puts the cursor at the start of the first editor line containing `text`. */
async function placeCursorOnLine(page: Page, text: string) {
  const line = page.locator('.monaco-editor .view-line', { hasText: text }).first()
  await expect(line).toBeVisible({ timeout: 30_000 })
  await line.click()
  await page.keyboard.press('Home')
}

async function activeEditor(page: Page) {
  return page.evaluate(() => {
    const probe = window.__monacoEditorE2E
    const selection = probe?.snapshot().selection
    return {
      file: probe?.filePath.split(/[\\/]/).pop() ?? null,
      line: selection?.positionLineNumber ?? null,
      column: selection?.positionColumn ?? null
    }
  })
}

/** Hovers the first characters of the first editor line containing `text`; returns the hover. */
async function hoverLineStart(page: Page, text: string) {
  await page.mouse.move(0, 0)
  const line = page.locator('.monaco-editor .view-line', { hasText: text }).first()
  const box = await line.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 12, box!.y + box!.height / 2)
  return page.locator('.monaco-hover:not(.hidden)').first()
}

async function screenshot(page: Page, name: string) {
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) })
  }
}

test.describe('code navigation through language servers', () => {
  test.skip(!RUN, 'set ORCA_E2E_CODE_NAVIGATION=1 (downloads the language servers)')

  test('TypeScript: F12, Cmd/Ctrl+click and Cmd/Ctrl+B open the definition; Shift+F12 peeks references; hover resolves imports; Back/Forward retrace jumps', async ({
    electronApp,
    orcaPage,
    testRepoPath,
    registerPostElectronShutdownCleanup
  }) => {
    test.setTimeout(180_000)
    const fixture = createGoldenWorktree(testRepoPath, 'code-navigation-ts')
    registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
    const root = fixture.worktreePath
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n')
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(
      join(root, 'lib', 'greeter.ts'),
      'export function greet(name: string): string {\n  return `Hello, ${name}`\n}\n'
    )
    writeFileSync(
      join(root, 'app.ts'),
      "import { greet } from './lib/greeter'\n\ngreet('world')\ngreet('again')\nconsole.log('done')\n"
    )

    await waitForSessionReady(orcaPage)
    await activateGoldenWorktree(orcaPage, testRepoPath, root)
    await openEditorFile(orcaPage, root, 'app.ts', 'typescript')

    await placeCursorOnLine(orcaPage, "greet('world')")
    await orcaPage.keyboard.press('F12')
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 90_000 })
      .toEqual({ file: 'greeter.ts', line: 1, column: 17 })
    await screenshot(orcaPage, 'ts-definition')

    await openEditorFile(orcaPage, root, 'app.ts', 'typescript')
    await placeCursorOnLine(orcaPage, "greet('again')")
    await orcaPage.keyboard.press('Shift+F12')
    const peek = orcaPage.locator('.reference-zone-widget')
    await expect(peek).toBeVisible({ timeout: 30_000 })
    // Import, two calls and the declaration, grouped under both files.
    await expect(peek.locator('.reference-file')).toHaveCount(2)
    await expect(peek.locator('.peekview-title')).toContainText('(4)')
    await screenshot(orcaPage, 'ts-references-peek')

    // Double-clicking a result in another file opens its tab, and the peek does not linger behind.
    await peek.locator('.monaco-list-row', { hasText: 'greeter.ts' }).click()
    await peek
      .locator('.monaco-list-row', { hasText: 'function greet(name' })
      .dblclick({ timeout: 30_000 })
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'greeter.ts', line: 1, column: 17 })
    await openEditorFile(orcaPage, root, 'app.ts', 'typescript')
    await expect
      .poll(async () => (await activeEditor(orcaPage)).file, { timeout: 30_000 })
      .toBe('app.ts')
    await screenshot(orcaPage, 'ts-after-peek-open')
    await expect(peek).toBeHidden()
    const callLine = orcaPage.locator('.monaco-editor .view-line', { hasText: "greet('world')" })
    const box = await callLine.first().boundingBox()
    expect(box).not.toBeNull()
    const target = { x: box!.x + 12, y: box!.y + box!.height / 2 }
    await orcaPage.keyboard.down(MOD)
    await orcaPage.mouse.move(target.x, target.y)
    await orcaPage.mouse.click(target.x, target.y)
    await orcaPage.keyboard.up(MOD)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'greeter.ts', line: 1, column: 17 })

    // The server resolves the import; Monaco's own worker would only know `greet` as `any`.
    await openEditorFile(orcaPage, root, 'app.ts', 'typescript')
    const hover = await hoverLineStart(orcaPage, "greet('again')")
    await expect(hover).toContainText('function greet(name: string): string', { timeout: 30_000 })
    await screenshot(orcaPage, 'ts-hover')

    // JetBrains keys: Cmd/Ctrl+B jumps without toggling the sidebar; Back / Forward retrace it.
    await orcaPage.mouse.move(0, 0)
    const sidebarOpen = () => orcaPage.evaluate(() => window.__store?.getState().sidebarOpen)
    const sidebarBefore = await sidebarOpen()
    await placeCursorOnLine(orcaPage, "greet('world')")
    await orcaPage.keyboard.press(`${MOD}+B`)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'greeter.ts', line: 1, column: 17 })
    expect(await sidebarOpen()).toBe(sidebarBefore)
    await orcaPage.keyboard.press(BACK)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'app.ts', line: 3, column: 1 })
    await orcaPage.keyboard.press(FORWARD)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'greeter.ts', line: 1, column: 17 })

    // A project containing Orca's own server files (like a project at the home folder) must not
    // capture a jump into them: the tab stays in this project and Back still returns.
    // Why realpath: the server reports resolved paths (macOS /var → /private/var).
    const userData = realpathSync(await electronApp.evaluate(({ app }) => app.getPath('userData')))
    await orcaPage.evaluate(async (folderPath) => {
      const state = window.__store!.getState()
      const group = await window.api.projectGroups.create({
        name: 'Server files',
        parentPath: folderPath,
        createdFrom: 'folder-scan'
      })
      await state.fetchProjectGroups()
      if (!group) {
        throw new Error('Could not create project group')
      }
      const workspace = await state.createFolderWorkspace({
        projectGroupId: group.id,
        name: 'server-files',
        folderPath
      })
      if (!workspace) {
        throw new Error('Could not create folder workspace')
      }
    }, userData)
    await activateGoldenWorktree(orcaPage, testRepoPath, root)
    const activeWorkspace = () =>
      orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId)
    const projectWorkspace = await activeWorkspace()
    await openEditorFile(orcaPage, root, 'app.ts', 'typescript')
    await placeCursorOnLine(orcaPage, "console.log('done')")
    await orcaPage.keyboard.press('F12')
    await expect
      .poll(async () => (await activeEditor(orcaPage)).file, { timeout: 30_000 })
      .toBe('lib.dom.d.ts')
    await expect(
      orcaPage.locator('.monaco-editor .view-line', { hasText: 'declare var console' })
    ).toBeVisible({ timeout: 30_000 })
    expect(await activeWorkspace()).toBe(projectWorkspace)
    await orcaPage.keyboard.press(BACK)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'app.ts', line: 5, column: 1 })
  })

  test('C#: F12 crosses projects and into decompiled code; Cmd/Ctrl+F12, Cmd/Ctrl+Alt+B and Cmd/Ctrl+Alt+click find the implementation (a MediatR request handler); hover works', async ({
    orcaPage,
    testRepoPath,
    registerPostElectronShutdownCleanup
  }) => {
    test.skip(!hasDotnet(), 'needs the .NET SDK on PATH')
    test.setTimeout(300_000)
    const fixture = createGoldenWorktree(testRepoPath, 'code-navigation-cs')
    registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
    const root = fixture.worktreePath
    const project = (extra: string) =>
      `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>enable</Nullable>\n${extra}  </PropertyGroup>\n</Project>\n`
    mkdirSync(join(root, 'Lib'), { recursive: true })
    mkdirSync(join(root, 'App'), { recursive: true })
    writeFileSync(join(root, 'Lib', 'Lib.csproj'), project(''))
    writeFileSync(
      join(root, 'App', 'App.csproj'),
      project('    <OutputType>Exe</OutputType>\n').replace(
        '</Project>',
        '  <ItemGroup>\n    <ProjectReference Include="../Lib/Lib.csproj" />\n  </ItemGroup>\n</Project>'
      )
    )
    writeFileSync(
      join(root, 'Sample.slnx'),
      '<Solution>\n  <Project Path="App/App.csproj" />\n  <Project Path="Lib/Lib.csproj" />\n</Solution>\n'
    )
    writeFileSync(
      join(root, 'Lib', 'Greeter.cs'),
      'namespace Lib;\n\npublic interface IGreeter\n{\n    string Greet(string name);\n}\n\npublic class Greeter : IGreeter\n{\n    public string Greet(string name) => $"Hello, {name}";\n}\n'
    )
    writeFileSync(
      join(root, 'App', 'Program.cs'),
      'using Lib;\n\nIGreeter greeter = new Greeter();\nConsole.WriteLine(greeter.Greet("world"));\nnew GetGreeting("world").ToString();\n'
    )
    // MediatR's shape without the package: a request, its handler, and the handler interface.
    writeFileSync(
      join(root, 'Lib', 'Mediator.cs'),
      'namespace Lib;\n\npublic interface IRequest<TResponse> { }\n\npublic interface IRequestHandler<TRequest, TResponse> where TRequest : IRequest<TResponse>\n{\n    Task<TResponse> Handle(TRequest request, CancellationToken cancellationToken);\n}\n'
    )
    writeFileSync(
      join(root, 'Lib', 'GetGreeting.cs'),
      'namespace Lib;\n\npublic sealed record GetGreeting(string Name) : IRequest<string>;\n'
    )
    writeFileSync(
      join(root, 'Lib', 'GetGreetingHandler.cs'),
      'namespace Lib;\n\npublic sealed class GetGreetingHandler : IRequestHandler<GetGreeting, string>\n{\n    public Task<string> Handle(GetGreeting request, CancellationToken cancellationToken) =>\n        Task.FromResult($"Hello, {request.Name}");\n}\n'
    )
    execFileSync('dotnet', ['restore', 'Sample.slnx'], { cwd: root, stdio: 'pipe' })

    await waitForSessionReady(orcaPage)
    await activateGoldenWorktree(orcaPage, testRepoPath, root)
    await openEditorFile(orcaPage, root, 'App/Program.cs', 'csharp')

    await placeCursorOnLine(orcaPage, 'IGreeter greeter')
    await orcaPage.keyboard.press('F12')
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 180_000 })
      .toEqual({ file: 'Greeter.cs', line: 3, column: 18 })
    await screenshot(orcaPage, 'cs-definition')

    await openEditorFile(orcaPage, root, 'App/Program.cs', 'csharp')
    await placeCursorOnLine(orcaPage, 'IGreeter greeter')
    await orcaPage.keyboard.press(`${MOD}+F12`)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 60_000 })
      .toEqual({ file: 'Greeter.cs', line: 8, column: 14 })
    await screenshot(orcaPage, 'cs-implementation')

    // JetBrains Go to Implementation: Cmd+Alt+B (Ctrl+Alt+B elsewhere).
    await openEditorFile(orcaPage, root, 'App/Program.cs', 'csharp')
    await placeCursorOnLine(orcaPage, 'IGreeter greeter')
    await orcaPage.keyboard.press(`${MOD}+Alt+B`)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 60_000 })
      .toEqual({ file: 'Greeter.cs', line: 8, column: 14 })

    // JetBrains Go to Implementation click: Cmd+Alt+click (Ctrl+Alt+click elsewhere); a definition
    // jump would stop at the interface on line 3 instead.
    await openEditorFile(orcaPage, root, 'App/Program.cs', 'csharp')
    await expect
      .poll(async () => (await activeEditor(orcaPage)).file, { timeout: 30_000 })
      .toBe('Program.cs')
    const declarationLine = orcaPage
      .locator('.monaco-editor .view-line', { hasText: 'IGreeter greeter' })
      .first()
    await expect(declarationLine).toBeVisible()
    const lineBox = await declarationLine.boundingBox()
    expect(lineBox).not.toBeNull()
    await orcaPage.keyboard.down(MOD)
    await orcaPage.keyboard.down('Alt')
    await orcaPage.mouse.click(lineBox!.x + 12, lineBox!.y + lineBox!.height / 2)
    await orcaPage.keyboard.up('Alt')
    await orcaPage.keyboard.up(MOD)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 60_000 })
      .toEqual({ file: 'Greeter.cs', line: 8, column: 14 })

    // MediatR: Go to Implementation on a request inside `new …(…)` lands on its handler's Handle.
    await openEditorFile(orcaPage, root, 'App/Program.cs', 'csharp')
    await placeCursorOnLine(orcaPage, 'new GetGreeting')
    await orcaPage.keyboard.press(WORD_RIGHT)
    await orcaPage.keyboard.press(WORD_RIGHT)
    await orcaPage.keyboard.press(`${MOD}+Alt+B`)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 60_000 })
      .toEqual({ file: 'GetGreetingHandler.cs', line: 5, column: 25 })

    await openEditorFile(orcaPage, root, 'App/Program.cs', 'csharp')
    const hover = await hoverLineStart(orcaPage, 'IGreeter greeter')
    // C# has no other hover source, so any hover here came from the language server.
    await expect(hover).toContainText('IGreeter', { timeout: 60_000 })
    await screenshot(orcaPage, 'cs-hover')

    // Framework types have no source here; F12 opens their decompiled code read-only.
    await orcaPage.mouse.move(0, 0)
    await placeCursorOnLine(orcaPage, 'Console.WriteLine')
    await orcaPage.keyboard.press('F12')
    await expect
      .poll(async () => (await activeEditor(orcaPage)).file, { timeout: 60_000 })
      .toBe('System.Console.cs')
    await expect(
      orcaPage.locator('.monaco-editor .view-line', { hasText: 'public static class Console' })
    ).toBeVisible()
    await screenshot(orcaPage, 'cs-decompiled')

    // Back returns from decompiled dependency code to where the jump started.
    await orcaPage.keyboard.press(BACK)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 30_000 })
      .toEqual({ file: 'Program.cs', line: 4, column: 1 })
  })
  test('ASP.NET MVC: tag helpers, View() and the C# in Razor views jump between views, controllers and models', async ({
    orcaPage,
    testRepoPath,
    registerPostElectronShutdownCleanup
  }) => {
    test.skip(!hasDotnet(), 'needs the .NET SDK on PATH')
    test.setTimeout(300_000)
    const fixture = createGoldenWorktree(testRepoPath, 'code-navigation-mvc')
    registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
    const root = fixture.worktreePath
    execFileSync('dotnet', ['new', 'mvc', '-n', 'Shop', '-o', root, '--force'], { stdio: 'pipe' })
    mkdirSync(join(root, 'Views', 'Orders'), { recursive: true })
    writeFileSync(
      join(root, 'Controllers', 'OrdersController.cs'),
      'using Microsoft.AspNetCore.Mvc;\n\nnamespace Shop.Controllers;\n\npublic class OrdersController : Controller\n{\n    public IActionResult Index()\n    {\n        return View();\n    }\n}\n'
    )
    // Why a BOM: Visual Studio and dotnet new save views with one.
    writeFileSync(
      join(root, 'Views', 'Orders', 'Index.cshtml'),
      '\uFEFF@model Shop.Models.ErrorViewModel\n<a asp-controller="Home"\n   asp-action="Privacy">Privacy</a>\n@Model.RequestId\n'
    )
    const homeLines = readFileSync(join(root, 'Controllers', 'HomeController.cs'), 'utf8').split(
      '\n'
    )
    const privacyLine = homeLines.findIndex((line) => line.includes('IActionResult Privacy('))
    const privacy = {
      file: 'HomeController.cs',
      line: privacyLine + 1,
      column: homeLines[privacyLine].indexOf('Privacy') + 1
    }
    const moveRight = async (count: number) => {
      for (let step = 0; step < count; step += 1) {
        await orcaPage.keyboard.press('ArrowRight')
      }
    }

    await waitForSessionReady(orcaPage)
    await activateGoldenWorktree(orcaPage, testRepoPath, root)
    await openEditorFile(orcaPage, root, 'Views/Orders/Index.cshtml', 'razor')

    // asp-action names the controller's action; Back returns to the view.
    await placeCursorOnLine(orcaPage, 'asp-action="Privacy"')
    await moveRight('asp-action="Pr'.length)
    await orcaPage.keyboard.press(`${MOD}+B`)
    await expect.poll(() => activeEditor(orcaPage), { timeout: 180_000 }).toEqual(privacy)
    await screenshot(orcaPage, 'mvc-asp-action')
    await orcaPage.keyboard.press(BACK)
    await expect
      .poll(async () => (await activeEditor(orcaPage)).file, { timeout: 30_000 })
      .toBe('Index.cshtml')

    // The C# inside the view resolves through csharp-ls.
    await placeCursorOnLine(orcaPage, '@Model.RequestId')
    await moveRight('@Model.Re'.length)
    await orcaPage.keyboard.press(`${MOD}+B`)
    await expect
      .poll(async () => (await activeEditor(orcaPage)).file, { timeout: 60_000 })
      .toBe('ErrorViewModel.cs')

    // return View() opens the action's view.
    await openEditorFile(orcaPage, root, 'Controllers/OrdersController.cs', 'csharp')
    await placeCursorOnLine(orcaPage, 'return View();')
    await moveRight('return Vi'.length)
    await orcaPage.keyboard.press(`${MOD}+B`)
    await expect
      .poll(() => activeEditor(orcaPage), { timeout: 60_000 })
      .toEqual({ file: 'Index.cshtml', line: 1, column: 1 })
    await screenshot(orcaPage, 'mvc-view')
  })
})
