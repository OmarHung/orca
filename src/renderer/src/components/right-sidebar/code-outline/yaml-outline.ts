import { isAlias, isMap, isNode, isScalar, isSeq, parseAllDocuments, type Node } from 'yaml'
import type { CodeOutlineSymbol, OffsetToPosition } from './code-outline-types'
import { buildDataTreeOutline, type DataTreeMember, type DataTreeReader } from './data-tree-outline'

function yamlReader(text: string): DataTreeReader<Node> {
  return {
    shape: (node) => (isMap(node) ? 'object' : isSeq(node) ? 'array' : 'scalar'),
    members: (node): DataTreeMember<Node>[] => {
      if (isMap(node)) {
        return node.items.flatMap((pair) => {
          const { key } = pair
          if (!isNode(key) || !key.range) {
            return []
          }
          const value = isNode(pair.value) ? pair.value : null
          const [keyStart, keyEnd] = key.range
          // Why: a complex key (`? [a, b]`) has no single value, so show it as written.
          const name = isScalar(key) ? String(key.value) : text.slice(keyStart, keyEnd)
          const end = value?.range?.[1] ?? keyEnd
          return [{ name, nameOffset: keyStart, start: keyStart, end, value }]
        })
      }
      if (isSeq(node)) {
        return node.items.flatMap((item, index) =>
          isNode(item) && item.range
            ? [
                {
                  name: String(index),
                  nameOffset: item.range[0],
                  start: item.range[0],
                  end: item.range[1],
                  value: item
                }
              ]
            : []
        )
      }
      return []
    },
    scalarText: (node) => {
      if (isAlias(node)) {
        return `*${node.source}`
      }
      return isScalar(node) && node.value !== null ? String(node.value) : undefined
    }
  }
}

/** Outline of every document in a YAML stream, in file order. */
export function yamlOutline(text: string, positionAt: OffsetToPosition): CodeOutlineSymbol[] {
  // Why: `---`-separated streams (Kubernetes manifests) carry one document per resource.
  const documents = parseAllDocuments(text, { uniqueKeys: false })
  const roots = Array.from(documents, (document) => document.contents).filter(isNode)
  return buildDataTreeOutline(roots, yamlReader(text), positionAt)
}
