import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Language, Parser } from '@vscode/tree-sitter-wasm'
import type { CodeOutlineSymbol } from '../code-outline-types'
import {
  extractTreeSitterOutline,
  type TreeSitterOutlineLanguage
} from '../tree-sitter-outline-extract'

const GRAMMAR_FILE: Record<TreeSitterOutlineLanguage, string> = {
  python: 'tree-sitter-python.wasm',
  csharp: 'tree-sitter-c-sharp.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  rust: 'tree-sitter-rust.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  php: 'tree-sitter-php.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  bash: 'tree-sitter-bash.wasm',
  powershell: 'tree-sitter-powershell.wasm',
  css: 'tree-sitter-css.wasm'
}

const wasmDir = dirname(createRequire(import.meta.url).resolve('@vscode/tree-sitter-wasm'))
let runtimeReady: Promise<void> | undefined

/** Parses with the real bundled grammar, as the renderer does, and extracts the outline. */
export async function loadOutliner(
  language: TreeSitterOutlineLanguage
): Promise<(source: string) => CodeOutlineSymbol[]> {
  runtimeReady ??= Parser.init({ locateFile: () => join(wasmDir, 'tree-sitter.wasm') })
  await runtimeReady
  const parser = new Parser()
  parser.setLanguage(await Language.load(readFileSync(join(wasmDir, GRAMMAR_FILE[language]))))
  return (source) => {
    const tree = parser.parse(source)
    if (!tree) {
      throw new Error('parse failed')
    }
    return extractTreeSitterOutline(language, tree.rootNode)
  }
}

export type OutlineShape = { name: string; kind: string; children?: OutlineShape[] }

/** Names and kinds only, so expectations stay readable. */
export function outlineShape(symbols: CodeOutlineSymbol[]): OutlineShape[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    ...(symbol.children.length > 0 ? { children: outlineShape(symbol.children) } : {})
  }))
}
