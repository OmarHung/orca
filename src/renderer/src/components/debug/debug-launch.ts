import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { basename } from '@/lib/path'
import type { DebugLaunchTarget } from '../../../../shared/debug/debug-session-types'
import { startDebugSession } from './debug-session-controller'

const WSL_UNC_PREFIX = /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i

const NODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']

/** The launch target for debugging a single file, or null when no adapter handles it. */
export function debugTargetForFile(
  filePath: string,
  pythonPath?: string
): DebugLaunchTarget | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.py')) {
    return { kind: 'python-file', filePath, ...(pythonPath ? { pythonPath } : {}) }
  }
  if (NODE_EXTENSIONS.some((extension) => lower.endsWith(extension)) && !lower.endsWith('.d.ts')) {
    return { kind: 'node-file', filePath }
  }
  return null
}

export function isDebuggableFile(filePath: string): boolean {
  return debugTargetForFile(filePath) !== null
}

/** Adapters run in this process's host only, so the workspace must live here too. */
export function isLocalDebugTarget(options: {
  repoHostId: string
  activeRuntimeIsLocal: boolean
  worktreePath: string
}): boolean {
  return (
    options.repoHostId === LOCAL_EXECUTION_HOST_ID &&
    options.activeRuntimeIsLocal &&
    !WSL_UNC_PREFIX.test(options.worktreePath)
  )
}

/** The worktree when it can be debugged here; otherwise explains why with a toast. */
function localWorktreeForDebugging(worktreeId: string): { path: string } | null {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  const repo = worktree ? state.repos.find((candidate) => candidate.id === worktree.repoId) : null
  if (!worktree || !repo) {
    toast.error(translate('debug.workspaceNotFound', 'Could not find the workspace for this file'))
    return null
  }
  const local = isLocalDebugTarget({
    repoHostId: getRepoExecutionHostId(repo),
    activeRuntimeIsLocal: getActiveRuntimeTarget(state.settings).kind === 'local',
    worktreePath: worktree.path
  })
  if (!local) {
    toast.error(
      translate(
        'debug.localOnly',
        'Debugging is only available for local workspaces for now (not SSH, WSL or remote runtimes)'
      )
    )
    return null
  }
  return worktree
}

export async function debugFile(
  worktreeId: string,
  filePath: string,
  pythonPath?: string
): Promise<void> {
  const target = debugTargetForFile(filePath, pythonPath)
  const worktree = target ? localWorktreeForDebugging(worktreeId) : null
  if (!target || !worktree) {
    return
  }
  await startDebugSession({ worktreeId, cwd: worktree.path, title: basename(filePath), target })
}

/** Debugs any launch target, e.g. one attached to a detected run configuration. */
export async function debugLaunchTarget(options: {
  worktreeId: string
  cwd: string
  title: string
  target: DebugLaunchTarget
}): Promise<void> {
  if (!localWorktreeForDebugging(options.worktreeId)) {
    return
  }
  await startDebugSession(options)
}
