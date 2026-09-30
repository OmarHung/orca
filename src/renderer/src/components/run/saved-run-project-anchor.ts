import { getRelativePathInsideRoot } from '@/lib/path'
import type {
  DebugRunConfiguration,
  RunConfigurationDefinition
} from '../../../../shared/run-configurations/run-configuration-definition'
import type {
  RunConfigurationEcosystem,
  RunConfigurationKind
} from '../../../../shared/run-configurations/run-configuration-types'
import { resolveRunConfigurationPath } from '../../../../shared/run-configurations/run-configuration-variables'

/** The project a saved configuration belongs to, so it can be listed with that detected project. */
export type SavedRunAnchor = {
  ecosystem: RunConfigurationEcosystem
  kind: RunConfigurationKind
  /** .NET configurations name their project file; the others only a folder. */
  by: 'projectFile' | 'folder'
  /** Workspace-relative, compared with `comparablePath`. */
  path: string
}

/** '/'-separated and case-folded, as the publish dialog already matches project files. */
export function comparablePath(path: string): string {
  return path
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

function workspaceRelative(path: string, worktreePath: string): string | null {
  const resolved = resolveRunConfigurationPath(path, { workspaceFolder: worktreePath })
  const relative = resolved.ok ? getRelativePathInsideRoot(resolved.value, worktreePath) : null
  return relative === null ? null : comparablePath(relative)
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function debugAnchor(
  configuration: DebugRunConfiguration,
  worktreePath: string
): SavedRunAnchor | null {
  const { target } = configuration
  switch (target.kind) {
    case 'dotnet-project': {
      const path = workspaceRelative(target.projectFile, worktreePath)
      return path === null ? null : { ecosystem: 'dotnet', kind: 'run', by: 'projectFile', path }
    }
    case 'python-file':
    case 'node-file': {
      const file = workspaceRelative(target.filePath, worktreePath)
      const ecosystem = target.kind === 'python-file' ? 'python' : 'node'
      return file === null ? null : { ecosystem, kind: 'run', by: 'folder', path: parentOf(file) }
    }
    case 'python-module':
    case 'node-script': {
      const path = workspaceRelative(configuration.cwd ?? '.', worktreePath)
      const ecosystem = target.kind === 'python-module' ? 'python' : 'node'
      return path === null ? null : { ecosystem, kind: 'run', by: 'folder', path }
    }
    case 'dotnet-program':
      // Why: a built .dll does not say which project produced it.
      return null
  }
}

/** Null for configurations that name no project (commands, compounds, outside the workspace). */
export function savedRunAnchor(
  configuration: RunConfigurationDefinition,
  worktreePath: string
): SavedRunAnchor | null {
  switch (configuration.type) {
    case 'dotnet-publish': {
      const path = workspaceRelative(configuration.projectFile, worktreePath)
      return path === null
        ? null
        : { ecosystem: 'dotnet', kind: 'publish', by: 'projectFile', path }
    }
    case 'debug':
      return debugAnchor(configuration, worktreePath)
    case 'command':
    case 'compound':
      return null
  }
}
