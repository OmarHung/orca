import type { CodeNavigationHover } from '../../shared/code-navigation/code-navigation-types'
import { isLspRange } from './lsp-locations'

function fence(language: string, value: string): string {
  return `\`\`\`${language}\n${value}\n\`\`\``
}

/** One `MarkupContent` or `MarkedString` as Markdown; null for anything else. */
function toMarkdown(content: unknown): string | null {
  if (typeof content === 'string') {
    return content
  }
  if (typeof content !== 'object' || content === null || !('value' in content)) {
    return null
  }
  const { value } = content
  if (typeof value !== 'string') {
    return null
  }
  if ('language' in content && typeof content.language === 'string') {
    return fence(content.language, value)
  }
  // Why fenced: plain text would otherwise be read as Markdown (`*`, `_` and `<` get eaten).
  return 'kind' in content && content.kind === 'plaintext' ? fence('text', value) : value
}

/** Converts an LSP `Hover` to Markdown blocks; null when it has nothing to show. */
export function lspHoverToCodeNavigationHover(result: unknown): CodeNavigationHover | null {
  if (typeof result !== 'object' || result === null || !('contents' in result)) {
    return null
  }
  const raw = Array.isArray(result.contents) ? result.contents : [result.contents]
  const contents = raw
    .map(toMarkdown)
    .filter((block): block is string => block !== null && block.trim().length > 0)
  if (contents.length === 0) {
    return null
  }
  const range = 'range' in result && isLspRange(result.range) ? result.range : undefined
  return range ? { contents, range } : { contents }
}
