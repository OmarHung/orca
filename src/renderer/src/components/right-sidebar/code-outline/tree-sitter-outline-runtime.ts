import type * as TreeSitter from '@vscode/tree-sitter-wasm'
import type { Language, Parser } from '@vscode/tree-sitter-wasm'
import runtimeWasmUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm?url'
import pythonWasmUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm?url'
import csharpWasmUrl from '@vscode/tree-sitter-wasm/wasm/tree-sitter-c-sharp.wasm?url'
import type { CodeOutlineSymbol } from './code-outline-types'
import {
  extractTreeSitterOutline,
  type TreeSitterOutlineLanguage
} from './tree-sitter-outline-extract'

const GRAMMAR_URL: Record<TreeSitterOutlineLanguage, string> = {
  python: pythonWasmUrl,
  csharp: csharpWasmUrl
}

let parserModulePromise: Promise<typeof TreeSitter> | undefined
const languagePromises = new Map<TreeSitterOutlineLanguage, Promise<Language>>()

async function fetchWasm(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load outline parser from ${url}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function loadParserModule(): Promise<typeof TreeSitter> {
  parserModulePromise ??= (async () => {
    const module = await import('@vscode/tree-sitter-wasm')
    // Why: Emscripten won't fetch `file://` URLs (packaged builds) and falls back to a Node-only
    // sync read, so hand it the bytes; `wasmBinary` passes through to the Emscripten module.
    const moduleOptions = {
      locateFile: () => runtimeWasmUrl,
      wasmBinary: await fetchWasm(runtimeWasmUrl)
    }
    await module.Parser.init(moduleOptions)
    return module
  })().catch((error: unknown) => {
    // Why: let the next file retry instead of caching a transient fetch failure forever.
    parserModulePromise = undefined
    throw error
  })
  return parserModulePromise
}

function loadLanguage(language: TreeSitterOutlineLanguage): Promise<Language> {
  const cached = languagePromises.get(language)
  if (cached) {
    return cached
  }
  const promise = (async () => {
    const module = await loadParserModule()
    return module.Language.load(await fetchWasm(GRAMMAR_URL[language]))
  })().catch((error: unknown) => {
    languagePromises.delete(language)
    throw error
  })
  languagePromises.set(language, promise)
  return promise
}

let sharedParser: Parser | undefined

export async function parseTreeSitterOutline(
  language: TreeSitterOutlineLanguage,
  source: string
): Promise<CodeOutlineSymbol[]> {
  const [module, grammar] = await Promise.all([loadParserModule(), loadLanguage(language)])
  sharedParser ??= new module.Parser()
  // Why: parsing is synchronous, so one parser can be re-pointed per call without interleaving.
  sharedParser.setLanguage(grammar)
  const tree = sharedParser.parse(source)
  if (!tree) {
    return []
  }
  try {
    return extractTreeSitterOutline(language, tree.rootNode)
  } finally {
    tree.delete()
  }
}
