import { realpath } from 'node:fs/promises'

/**
 * Translates between the paths the editor uses and the resolved paths debuggers match on.
 * Why: builds record symlink-resolved source paths (macOS `/var` → `/private/var`), so a
 * breakpoint on the editor's path never binds and paused frames would not map back.
 */
export class DebugPathMapping {
  private readonly editorPathByResolved = new Map<string, string>()

  constructor(private readonly resolve: (path: string) => Promise<string> = realpath) {}

  async toAdapter(editorPath: string): Promise<string> {
    let resolved: string
    try {
      resolved = await this.resolve(editorPath)
    } catch {
      return editorPath
    }
    if (resolved !== editorPath) {
      this.editorPathByResolved.set(resolved, editorPath)
    }
    return resolved
  }

  fromAdapter(adapterPath: string): string {
    return this.editorPathByResolved.get(adapterPath) ?? adapterPath
  }

  async breakpointsToAdapter<T>(byPath: Record<string, T>): Promise<Record<string, T>> {
    const entries = await Promise.all(
      Object.entries(byPath).map(
        async ([path, value]) => [await this.toAdapter(path), value] as const
      )
    )
    return Object.fromEntries(entries)
  }

  /** Rewrites `source.path` in request arguments (setBreakpoints) for the adapter. */
  async requestToAdapter(command: string, args: unknown): Promise<unknown> {
    if (command !== 'setBreakpoints' || !isRecord(args) || !isRecord(args.source)) {
      return args
    }
    const path = args.source.path
    return typeof path === 'string'
      ? { ...args, source: { ...args.source, path: await this.toAdapter(path) } }
      : args
  }

  /** Rewrites stack frame source paths in a stackTrace response for the editor. */
  responseFromAdapter(command: string, body: unknown): unknown {
    if (command !== 'stackTrace' || !isRecord(body) || !Array.isArray(body.stackFrames)) {
      return body
    }
    return {
      ...body,
      stackFrames: body.stackFrames.map((frame: unknown) => {
        if (!isRecord(frame) || !isRecord(frame.source) || typeof frame.source.path !== 'string') {
          return frame
        }
        return { ...frame, source: { ...frame.source, path: this.fromAdapter(frame.source.path) } }
      })
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
