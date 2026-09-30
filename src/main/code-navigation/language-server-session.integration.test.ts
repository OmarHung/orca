import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { LanguageServerSession } from './language-server-session'

// Opt-in: point at an extracted server (TypeScript 7's `package/lib/tsc`, csharp-ls's dll).
const tscNative = process.env.ORCA_TEST_TSC_NATIVE
const csharpLsDll = process.env.ORCA_TEST_CSHARP_LS_DLL

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function tempWorkspace(prefix: string): Promise<string> {
  // Why realpath: servers report resolved paths (macOS /var → /private/var).
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

function track(session: LanguageServerSession): LanguageServerSession {
  cleanups.push(() => session.dispose())
  return session
}

describe.skipIf(!tscNative)('LanguageServerSession against TypeScript 7', () => {
  it('jumps to a definition in another file and finds its references', async () => {
    const root = await tempWorkspace('orca-ts-lsp-it-')
    await writeFile(join(root, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }')
    await writeFile(
      join(root, 'greeter.ts'),
      'export function greet(name: string) {\n  return name\n}\n'
    )
    const appPath = join(root, 'app.ts')
    const appText = "import { greet } from './greeter'\n\ngreet('world')\n"
    await writeFile(appPath, appText)
    const session = track(
      new LanguageServerSession({
        root,
        launch: { program: tscNative!, args: ['--lsp', '--stdio'], env: process.env }
      })
    )
    const document = { path: appPath, languageId: 'typescript', version: 1, text: appText }

    const definitions = await session.query('definition', document, { line: 2, character: 1 })
    const references = await session.query('references', document, { line: 2, character: 1 })

    expect(definitions).toEqual([
      {
        path: join(root, 'greeter.ts'),
        range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } }
      }
    ])
    expect(references.map((reference) => reference.path).sort()).toEqual(
      [appPath, appPath, join(root, 'greeter.ts')].sort()
    )
  }, 60_000)
})

describe.skipIf(!csharpLsDll)('LanguageServerSession against csharp-ls', () => {
  it('jumps from one project into another', async () => {
    const dotnet = await resolveCommandOnLocalPath('dotnet')
    expect(dotnet).not.toBeNull()
    const root = await tempWorkspace('orca-csharp-lsp-it-')
    const run = (args: string[]) =>
      runProcess({ program: dotnet!, args, cwd: root, timeoutMs: 180_000 })
    await run(['new', 'sln', '-n', 'Sample'])
    await run(['new', 'classlib', '-n', 'Lib', '-o', join(root, 'Lib')])
    await run(['new', 'console', '-n', 'App', '-o', join(root, 'App')])
    const solution = (await readFile(join(root, 'Sample.slnx'), 'utf8').catch(() => null))
      ? 'Sample.slnx'
      : 'Sample.sln'
    await run(['sln', solution, 'add', join('Lib', 'Lib.csproj'), join('App', 'App.csproj')])
    await run(['add', join('App', 'App.csproj'), 'reference', join('Lib', 'Lib.csproj')])
    await rm(join(root, 'Lib', 'Class1.cs'), { force: true })
    await writeFile(
      join(root, 'Lib', 'Greeter.cs'),
      'namespace Lib;\n\npublic class Greeter\n{\n    public string Greet(string name) => name;\n}\n'
    )
    const programPath = join(root, 'App', 'Program.cs')
    const programText = 'var greeter = new Lib.Greeter();\nConsole.WriteLine(greeter.Greet("x"));\n'
    await writeFile(programPath, programText)
    const session = track(
      new LanguageServerSession({
        root,
        launch: {
          program: dotnet!,
          args: [csharpLsDll!],
          env: { ...process.env, DOTNET_ROLL_FORWARD: 'Major' }
        }
      })
    )

    const definitions = await session.query(
      'definition',
      { path: programPath, languageId: 'csharp', version: 1, text: programText },
      { line: 1, character: 27 }
    )

    expect(definitions).toEqual([
      expect.objectContaining({ path: join(root, 'Lib', 'Greeter.cs') })
    ])
  }, 300_000)
})
