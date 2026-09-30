import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
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

  test('TypeScript: F12 and Cmd/Ctrl+click open the definition in another tab; Shift+F12 peeks references; hover resolves imports', async ({
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
      "import { greet } from './lib/greeter'\n\ngreet('world')\ngreet('again')\n"
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

    await orcaPage.keyboard.press('Escape')
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
  })

  test('C#: F12 crosses projects and into decompiled code, Cmd/Ctrl+F12 finds the implementation, hover works', async ({
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
      'using Lib;\n\nIGreeter greeter = new Greeter();\nConsole.WriteLine(greeter.Greet("world"));\n'
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
  })
})
