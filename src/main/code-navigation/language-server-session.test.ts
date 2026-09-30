import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LanguageServerSession } from './language-server-session'
import { createFakeLspTransport, type FakeLspMessage } from './lsp-test-transport'
import type { StdioDapTransportSpec } from '../debug/dap-transport-stdio'

const root = join(process.cwd(), 'workspace')
const filePath = join(root, 'src', 'app.ts')
const fileUri = pathToFileURL(filePath).href
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function startSession() {
  const fake = createFakeLspTransport()
  const specs: StdioDapTransportSpec[] = []
  const session = new LanguageServerSession({
    root,
    launch: { program: '/bin/server', args: ['--stdio'], env: {} },
    startTransport: (spec) => {
      specs.push(spec)
      return fake.transport
    }
  })
  const methods = (): (string | undefined)[] => fake.sent.map((message) => message.method)
  const last = (method: string): FakeLspMessage | undefined =>
    fake.sent.findLast((message) => message.method === method)
  return { fake, specs, session, methods, last }
}

async function startReadySession() {
  const started = startSession()
  started.fake.reply(started.last('initialize')?.id, { capabilities: {} })
  await started.session.whenReady()
  return started
}

function document(version: number, text = 'export const a = 1') {
  return { path: filePath, languageId: 'typescript', version, text }
}

async function answerNextQuery(
  started: Awaited<ReturnType<typeof startReadySession>>,
  method: string,
  result: unknown
): Promise<void> {
  await flush()
  started.fake.reply(started.last(method)?.id, result)
}

describe('LanguageServerSession', () => {
  it('starts the server in the workspace root and completes the handshake', async () => {
    const { specs, last, methods, fake, session } = startSession()

    expect(specs[0]).toMatchObject({ program: '/bin/server', args: ['--stdio'], cwd: root })
    expect(last('initialize')?.params).toMatchObject({
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href }]
    })
    fake.reply(last('initialize')?.id, { capabilities: {} })
    await session.whenReady()

    expect(methods()).toContain('initialized')
  })

  it('opens a document once and resends it only when its version changes', async () => {
    const started = await startReadySession()
    const { session, fake, methods } = started

    const first = session.query('definition', document(3), { line: 0, character: 14 })
    await answerNextQuery(started, 'textDocument/definition', null)
    await first
    const second = session.query('definition', document(3), { line: 0, character: 14 })
    await answerNextQuery(started, 'textDocument/definition', null)
    await second
    const third = session.query('definition', document(4, 'export const b = 2'), {
      line: 0,
      character: 14
    })
    await answerNextQuery(started, 'textDocument/definition', null)
    await third

    expect(methods().filter((method) => method === 'textDocument/didOpen')).toHaveLength(1)
    const changes = fake.sent.filter((message) => message.method === 'textDocument/didChange')
    expect(changes).toHaveLength(1)
    expect(changes[0].params).toEqual({
      textDocument: { uri: fileUri, version: 2 },
      contentChanges: [{ text: 'export const b = 2' }]
    })
  })

  it('asks for references including the declaration and returns file locations', async () => {
    const started = await startReadySession()
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }

    const pending = started.session.query('references', document(1), { line: 0, character: 14 })
    await answerNextQuery(started, 'textDocument/references', [{ uri: fileUri, range }])

    await expect(pending).resolves.toEqual([{ path: filePath, range }])
    expect(started.last('textDocument/references')?.params).toMatchObject({
      textDocument: { uri: fileUri },
      position: { line: 0, character: 14 },
      context: { includeDeclaration: true }
    })
  })

  it('closes only documents it opened', async () => {
    const started = await startReadySession()
    const pending = started.session.query('definition', document(1), { line: 0, character: 0 })
    await answerNextQuery(started, 'textDocument/definition', null)
    await pending

    started.session.closeDocument(join(root, 'never-opened.ts'))
    started.session.closeDocument(filePath)
    started.session.closeDocument(filePath)

    const closes = started.fake.sent.filter((message) => message.method === 'textDocument/didClose')
    expect(closes).toEqual([
      expect.objectContaining({ params: { textDocument: { uri: fileUri } } })
    ])
  })

  it('reports file changes with LSP change types', async () => {
    const started = await startReadySession()

    started.session.filesChanged([
      { kind: 'create', path: filePath },
      { kind: 'delete', path: join(root, 'old.ts') }
    ])
    await flush()

    expect(started.last('workspace/didChangeWatchedFiles')?.params).toEqual({
      changes: [
        { uri: fileUri, type: 1 },
        { uri: pathToFileURL(join(root, 'old.ts')).href, type: 3 }
      ]
    })
  })

  it('fails with the server stderr when it exits before initializing', async () => {
    const { specs, fake, session } = startSession()
    specs[0].onStderr?.('You must install or update .NET to run this application.\n')
    fake.exit({ code: 150 })

    await expect(session.whenReady()).rejects.toThrow(
      'The language server exited: You must install or update .NET to run this application.'
    )
    expect(session.isExited()).toBe(true)
  })

  it('shuts the server down politely on dispose', async () => {
    const started = await startReadySession()

    const disposed = started.session.dispose()
    await flush()
    started.fake.reply(started.last('shutdown')?.id, null)
    await disposed

    expect(started.methods().slice(-2)).toEqual(['shutdown', 'exit'])
    expect(started.fake.closed()).toBe(true)
  })
})
