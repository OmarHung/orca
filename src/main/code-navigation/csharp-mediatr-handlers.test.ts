import { describe, expect, it, vi } from 'vitest'
import { csharpImplementations, type MediatrSession } from './csharp-mediatr-handlers'
import type { LspLocation } from './lsp-locations'

const document = {
  path: '/shop/Controllers/ArticlesController.cs',
  languageId: 'csharp',
  version: 1,
  text: ''
}
const position = { line: 23, character: 50 }
const at = (uri: string, line: number, character: number): LspLocation => ({
  uri,
  range: { start: { line, character }, end: { line, character: character + 5 } }
})

const QUERY = 'file:///shop/Queries/ListArticlesQuery.cs'
const HANDLER = 'file:///shop/Queries/ListArticlesQueryHandler.cs'
const EVENTS = 'file:///shop/Events/Handlers.cs'
const FILES: Record<string, string[]> = {
  '/shop/Queries/ListArticlesQueryHandler.cs': [
    'namespace Shop.Queries;',
    'public sealed class ListArticlesQueryHandler(IRepo repo)',
    '    : IRequestHandler<ListArticlesQuery, ArticlesResult>',
    '{',
    '    public async Task<ArticlesResult> Handle(ListArticlesQuery request, CancellationToken ct)'
  ],
  '/shop/Events/Handlers.cs': [
    'class Mailer : INotificationHandler<Events.ArticlePublished>',
    '{ public Task Handle(Events.ArticlePublished e, CancellationToken ct) => Task.CompletedTask; }',
    'class Audit : INotificationHandler<ArticlePublished>',
    '{',
    '  public Task Handle(ArticlePublished e, CancellationToken ct) => Task.CompletedTask;',
    '}'
  ]
}

function session(options: {
  implementations: LspLocation[]
  definition: LspLocation[]
  references?: LspLocation[]
}): MediatrSession & { request: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn(async (feature: 'definition' | 'implementation') =>
      feature === 'definition' ? options.definition : options.implementations
    ),
    request: vi.fn(async () => options.references ?? [])
  }
}

const readLines = async (path: string) => FILES[path] ?? null

describe('csharpImplementations', () => {
  it("lands on a request's handler Handle method when the type has no other implementation", async () => {
    const declaration = at(QUERY, 6, 14)
    const server = session({
      implementations: [declaration],
      definition: [declaration],
      references: [
        at(HANDLER, 4, 45),
        at(HANDLER, 2, 22),
        at('file:///shop/Controllers/ArticlesController.cs', 23, 45)
      ]
    })

    const result = await csharpImplementations(server, document, position, readLines)

    expect(server.request).toHaveBeenCalledWith('textDocument/references', {
      textDocument: { uri: QUERY },
      position: declaration.range.start,
      context: { includeDeclaration: false }
    })
    expect(result).toEqual([
      {
        uri: HANDLER,
        range: { start: { line: 4, character: 38 }, end: { line: 4, character: 44 } }
      }
    ])
  })

  it('lists every notification handler, each at its own Handle method', async () => {
    const declaration = at('file:///shop/Events/ArticlePublished.cs', 2, 14)
    const server = session({
      implementations: [],
      definition: [declaration],
      references: [at(EVENTS, 0, 43), at(EVENTS, 1, 28), at(EVENTS, 2, 35), at(EVENTS, 4, 21)]
    })

    const result = await csharpImplementations(server, document, position, readLines)

    expect(result.map((location) => location.range.start)).toEqual([
      { line: 1, character: 14 },
      { line: 4, character: 14 }
    ])
  })

  it('keeps real implementations and falls back when no handler exists', async () => {
    const declaration = at('file:///shop/IGreeter.cs', 2, 17)
    const implementer = at('file:///shop/Greeter.cs', 4, 13)
    const withImplementer = session({ implementations: [implementer], definition: [declaration] })
    expect(await csharpImplementations(withImplementer, document, position, readLines)).toEqual([
      implementer
    ])
    expect(withImplementer.request).not.toHaveBeenCalled()

    const plainClass = session({ implementations: [declaration], definition: [declaration] })
    expect(await csharpImplementations(plainClass, document, position, readLines)).toEqual([
      declaration
    ])
  })
})
