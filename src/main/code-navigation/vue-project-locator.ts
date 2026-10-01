import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'

export type VueProject = {
  /** The folder of the package.json that depends on vue or nuxt. */
  root: string
  nuxt: boolean
}

type ReadText = (path: string) => Promise<string | null>

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

function dependencyNames(text: string): Set<string> {
  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch {
    return new Set()
  }
  if (typeof manifest !== 'object' || manifest === null) {
    return new Set()
  }
  const names = DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = field in manifest ? Reflect.get(manifest, field) : undefined
    return typeof dependencies === 'object' && dependencies !== null
      ? Object.keys(dependencies)
      : []
  })
  return new Set(names)
}

/**
 * Which files belong to a Vue project, so their navigation goes through the Vue-aware server.
 * The nearest package.json decides: a workspace package without vue stays on TypeScript 7.
 */
export class VueProjectLocator {
  private readonly nearestByDir = new Map<string, Promise<VueProject | null>>()

  constructor(
    private readonly readText: ReadText = (path) => readFile(path, 'utf8').catch(() => null)
  ) {}

  projectFor(filePath: string, workspaceRoot: string): Promise<VueProject | null> {
    const dir = dirname(filePath)
    return isPathInsideOrEqual(workspaceRoot, dir)
      ? this.nearest(dir, workspaceRoot)
      : Promise.resolve(null)
  }

  /** Forgets every package.json read, e.g. after one changed. */
  invalidate(): void {
    this.nearestByDir.clear()
  }

  private nearest(dir: string, workspaceRoot: string): Promise<VueProject | null> {
    const key = `${workspaceRoot}\0${dir}`
    const cached = this.nearestByDir.get(key)
    if (cached) {
      return cached
    }
    const pending = (async (): Promise<VueProject | null> => {
      const text = await this.readText(join(dir, 'package.json'))
      if (text !== null) {
        const names = dependencyNames(text)
        return names.has('vue') || names.has('nuxt') ? { root: dir, nuxt: names.has('nuxt') } : null
      }
      const parent = dirname(dir)
      return parent !== dir && isPathInsideOrEqual(workspaceRoot, parent)
        ? this.nearest(parent, workspaceRoot)
        : null
    })()
    this.nearestByDir.set(key, pending)
    return pending
  }
}
