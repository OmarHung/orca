import type { CodeOutlineSymbol } from '../code-outline-types'
import {
  childOfType,
  compactText,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const CSS_AT_RULE_TYPES = new Set([
  'media_statement',
  'supports_statement',
  'keyframes_statement',
  'at_rule'
])

// Why: kinds follow VS Code's CSS outline — rule sets as classes, block at-rules as modules.
function cssStatements(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child): CodeOutlineSymbol[] => {
    if (child.type === 'rule_set') {
      const selectors = childOfType(child, 'selectors')
      const block = childOfType(child, 'block')
      const children = block ? cssStatements(block) : []
      return selectors
        ? [makeSymbol(child, selectors, 'class', children, undefined, compactText(selectors))]
        : []
    }
    if (!CSS_AT_RULE_TYPES.has(child.type)) {
      return []
    }
    const block = childOfType(child, 'block')
    // Why: `@import`/`@use` have no block; `@keyframes` steps aren't worth listing.
    if (!block && child.type !== 'keyframes_statement') {
      return []
    }
    const prelude = child.text.split('{')[0].replace(/\s+/g, ' ').trim()
    const children = block ? cssStatements(block) : []
    return [makeSymbol(child, child, 'namespace', children, undefined, prelude)]
  })
}

export function cssOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return cssStatements(root)
}
