import type { CodeOutlineSymbol } from './code-outline-types'
import type { OutlineExtractor, OutlineSyntaxNode } from './tree-sitter-outline-symbol'
import { cppOutline } from './tree-sitter-extractors/cpp-outline'
import { csharpOutline } from './tree-sitter-extractors/csharp-outline'
import { cssOutline } from './tree-sitter-extractors/css-outline'
import { goOutline } from './tree-sitter-extractors/go-outline'
import { javaOutline } from './tree-sitter-extractors/java-outline'
import { phpOutline } from './tree-sitter-extractors/php-outline'
import { powershellOutline } from './tree-sitter-extractors/powershell-outline'
import { pythonOutline } from './tree-sitter-extractors/python-outline'
import { rubyOutline } from './tree-sitter-extractors/ruby-outline'
import { rustOutline } from './tree-sitter-extractors/rust-outline'
import { shellOutline } from './tree-sitter-extractors/shell-outline'

/** One per grammar bundled with @vscode/tree-sitter-wasm that the outline reads. */
export type TreeSitterOutlineLanguage =
  | 'python'
  | 'csharp'
  | 'go'
  | 'java'
  | 'rust'
  | 'cpp'
  | 'php'
  | 'ruby'
  | 'bash'
  | 'powershell'
  | 'css'

const EXTRACTORS: Record<TreeSitterOutlineLanguage, OutlineExtractor> = {
  python: pythonOutline,
  csharp: csharpOutline,
  go: goOutline,
  java: javaOutline,
  rust: rustOutline,
  cpp: cppOutline,
  php: phpOutline,
  ruby: rubyOutline,
  bash: shellOutline,
  powershell: powershellOutline,
  css: cssOutline
}

export function extractTreeSitterOutline(
  language: TreeSitterOutlineLanguage,
  root: OutlineSyntaxNode
): CodeOutlineSymbol[] {
  return EXTRACTORS[language](root)
}
