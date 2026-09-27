import type * as Monaco from 'monaco-editor'
import type { CodeOutlineSymbol } from './code-outline-types'
import { navigationTreeToOutline } from './typescript-navigation-outline'
import { jsonDocumentToOutline } from './json-outline'
import type { TreeSitterOutlineLanguage } from './tree-sitter-outline-extract'

type OutlineSource = 'typescript' | 'javascript' | 'json' | 'yaml' | TreeSitterOutlineLanguage

/** Monaco language id → where its outline comes from. */
const SOURCE_BY_LANGUAGE = new Map<string, OutlineSource>([
  ['typescript', 'typescript'],
  ['javascript', 'javascript'],
  ['python', 'python'],
  ['csharp', 'csharp'],
  ['go', 'go'],
  ['java', 'java'],
  ['rust', 'rust'],
  // Why: no C grammar is bundled; the C++ one parses C's declarations the same way.
  ['c', 'cpp'],
  ['cpp', 'cpp'],
  ['php', 'php'],
  ['ruby', 'ruby'],
  ['shell', 'bash'],
  ['powershell', 'powershell'],
  ['css', 'css'],
  ['json', 'json'],
  ['yaml', 'yaml']
])

export function isCodeOutlineLanguage(languageId: string): boolean {
  return SOURCE_BY_LANGUAGE.has(languageId)
}

const WORKER_REGISTRATION_ATTEMPTS = 60
const WORKER_REGISTRATION_RETRY_MS = 250

// Why: Monaco registers a language worker lazily after the first model of that language appears,
// so an outline requested as the file opens can arrive first and be told it is "not registered".
// Monaco rejects with a bare string there, not an Error.
async function waitForMonacoWorker<T>(getWorker: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getWorker()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('not registered') || attempt >= WORKER_REGISTRATION_ATTEMPTS) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, WORKER_REGISTRATION_RETRY_MS))
    }
  }
}

async function loadTypeScriptOutline(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  source: 'typescript' | 'javascript'
): Promise<CodeOutlineSymbol[]> {
  const getWorker = await waitForMonacoWorker(() =>
    source === 'typescript'
      ? monaco.typescript.getTypeScriptWorker()
      : monaco.typescript.getJavaScriptWorker()
  )
  const worker = await getWorker(model.uri)
  const tree: unknown = await worker.getNavigationTree(model.uri.toString())
  if (model.isDisposed()) {
    return []
  }
  return navigationTreeToOutline(tree, (offset) => model.getPositionAt(offset))
}

// Why: Monaco's JSON worker already parses the model (comments included) for validation.
async function loadJsonOutline(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
): Promise<CodeOutlineSymbol[]> {
  const getWorker = await waitForMonacoWorker(() => monaco.json.getWorker())
  const worker = await getWorker(model.uri)
  const document = await worker.parseJSONDocument(model.uri.toString())
  if (model.isDisposed()) {
    return []
  }
  return jsonDocumentToOutline(document?.root, (offset) => model.getPositionAt(offset))
}

/** Returns null when the model's language has no outline source. */
export async function loadCodeOutline(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
): Promise<CodeOutlineSymbol[] | null> {
  const source = SOURCE_BY_LANGUAGE.get(model.getLanguageId())
  if (!source) {
    return null
  }
  if (source === 'typescript' || source === 'javascript') {
    return loadTypeScriptOutline(monaco, model, source)
  }
  if (source === 'json') {
    return loadJsonOutline(monaco, model)
  }
  if (source === 'yaml') {
    const { yamlOutline } = await import('./yaml-outline')
    return yamlOutline(model.getValue(), (offset) => model.getPositionAt(offset))
  }
  // Why: the WASM parsers are several MB; load one only once a file of its language is outlined.
  const { parseTreeSitterOutline } = await import('./tree-sitter-outline-runtime')
  return parseTreeSitterOutline(source, model.getValue())
}
