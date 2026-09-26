import type * as Monaco from 'monaco-editor'
import type { CodeOutlineSymbol } from './code-outline-types'
import { navigationTreeToOutline } from './typescript-navigation-outline'
import type { TreeSitterOutlineLanguage } from './tree-sitter-outline-extract'

type OutlineSource = 'typescript' | 'javascript' | TreeSitterOutlineLanguage

const SOURCE_BY_LANGUAGE = new Map<string, OutlineSource>([
  ['typescript', 'typescript'],
  ['javascript', 'javascript'],
  ['python', 'python'],
  ['csharp', 'csharp']
])

export function isCodeOutlineLanguage(languageId: string): boolean {
  return SOURCE_BY_LANGUAGE.has(languageId)
}

const WORKER_REGISTRATION_ATTEMPTS = 60
const WORKER_REGISTRATION_RETRY_MS = 250

type WorkerAccessor = Awaited<ReturnType<typeof Monaco.typescript.getTypeScriptWorker>>

// Why: Monaco registers the TS worker lazily after the first model of that language appears, so
// an outline requested as the file opens can arrive first and be told it is "not registered".
async function waitForTypeScriptWorker(
  monaco: typeof Monaco,
  source: 'typescript' | 'javascript'
): Promise<WorkerAccessor> {
  for (let attempt = 1; ; attempt++) {
    try {
      return source === 'typescript'
        ? await monaco.typescript.getTypeScriptWorker()
        : await monaco.typescript.getJavaScriptWorker()
    } catch (error) {
      const notRegistered = error instanceof Error && error.message.includes('not registered')
      if (!notRegistered || attempt >= WORKER_REGISTRATION_ATTEMPTS) {
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
  const getWorker = await waitForTypeScriptWorker(monaco, source)
  const worker = await getWorker(model.uri)
  const tree: unknown = await worker.getNavigationTree(model.uri.toString())
  if (model.isDisposed()) {
    return []
  }
  return navigationTreeToOutline(tree, (offset) => model.getPositionAt(offset))
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
  // Why: the WASM parsers are several MB; load them only once a Python/C# file is outlined.
  const { parseTreeSitterOutline } = await import('./tree-sitter-outline-runtime')
  return parseTreeSitterOutline(source, model.getValue())
}
