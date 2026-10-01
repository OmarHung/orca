import { access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  CodeNavigationFileChange,
  CodeNavigationServerKind
} from '../../shared/code-navigation/code-navigation-types'
import { VueProjectLocator } from './vue-project-locator'

export type CodeNavigationRoute = {
  kind: CodeNavigationServerKind
  root: string
  /** A Nuxt project, whose auto-imports resolve through generated `.nuxt/` types. */
  nuxt: boolean
}

export type CodeNavigationRouterDeps = {
  projects?: Pick<VueProjectLocator, 'projectFor' | 'invalidate'>
  pathExists?: (path: string) => Promise<boolean>
}

const defaultPathExists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/**
 * Picks the server for a file. The renderer asks by extension within its workspace; in a Vue
 * project TypeScript files go to the Vue server too, or their usages in `.vue` files are missed.
 */
export class CodeNavigationRouter {
  private readonly projects: Pick<VueProjectLocator, 'projectFor' | 'invalidate'>
  private readonly pathExists: (path: string) => Promise<boolean>
  private readonly routesByDocument = new Map<string, CodeNavigationRoute>()
  private readonly nuxtHintsShown = new Set<string>()

  constructor(deps: CodeNavigationRouterDeps = {}) {
    this.projects = deps.projects ?? new VueProjectLocator()
    this.pathExists = deps.pathExists ?? defaultPathExists
  }

  async route(
    kind: CodeNavigationServerKind,
    root: string,
    path: string
  ): Promise<CodeNavigationRoute> {
    if (kind !== 'typescript' && kind !== 'vue') {
      return { kind, root, nuxt: false }
    }
    const project = await this.projects.projectFor(path, root)
    const route: CodeNavigationRoute = project
      ? { kind: 'vue', root: project.root, nuxt: project.nuxt }
      : { kind, root, nuxt: false }
    this.routesByDocument.set(path, route)
    return route
  }

  /** Where a document went when it was queried, forgetting it; closing must reach that server. */
  closeDocument(
    kind: CodeNavigationServerKind,
    root: string,
    path: string
  ): Pick<CodeNavigationRoute, 'kind' | 'root'> {
    const route = this.routesByDocument.get(path)
    this.routesByDocument.delete(path)
    return route ? { kind: route.kind, root: route.root } : { kind, root }
  }

  /** True once per Nuxt project without `.nuxt/`, the generated types auto-imports need. */
  async needsNuxtHint(route: CodeNavigationRoute): Promise<boolean> {
    if (!route.nuxt || this.nuxtHintsShown.has(route.root)) {
      return false
    }
    const missing = !(await this.pathExists(join(route.root, '.nuxt')))
    if (missing) {
      this.nuxtHintsShown.add(route.root)
    }
    return missing
  }

  filesChanged(changes: readonly CodeNavigationFileChange[]): void {
    if (changes.some((change) => basename(change.path) === 'package.json')) {
      this.projects.invalidate()
    }
  }
}
