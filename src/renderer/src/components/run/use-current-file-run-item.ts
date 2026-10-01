import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { basename, getRelativePathInsideRoot } from '@/lib/path'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { quoteShellArgument } from '../../../../shared/run-configurations/run-configuration-types'
import { debugTargetForFile } from '../debug/debug-launch'
import { useDebugLaunchTarget } from '../debug/use-debug-launch-target'
import { usePythonFileContext } from '../python/use-python-file-context'
import type { RunTarget } from './run-target'
import { CURRENT_FILE_ITEM_KEY, type RunWidgetItem } from './run-widget-items'

function nodeFileRunTarget(
  worktreeId: string,
  groupId: string | null,
  filePath: string,
  worktreePath: string
): RunTarget | null {
  const quotedPath = quoteShellArgument(
    getRelativePathInsideRoot(filePath, worktreePath) ?? filePath
  )
  if (quotedPath === null) {
    return null
  }
  const commandKey = `node-file:${filePath}`
  return {
    worktreeId,
    groupId,
    commandKey,
    command: {
      id: commandKey,
      label: basename(filePath),
      command: `node ${quotedPath}`,
      appendEnter: true
    }
  }
}

/** The Run widget's "Current File" entry while a JavaScript/TypeScript or Python file is open. */
export function useCurrentFileRunItem(
  worktreeId: string,
  groupId: string | null
): RunWidgetItem | null {
  const launch = useDebugLaunchTarget()
  const python = usePythonFileContext()
  const worktreePath = useAppStore((s) =>
    launch ? (findWorktreeById(s.worktreesByRepo, launch.worktreeId)?.path ?? null) : null
  )
  if (!launch || launch.worktreeId !== worktreeId || worktreePath === null) {
    return null
  }
  const label = translate('run.currentFile.named', 'Current File: {{value0}}', {
    value0: basename(launch.filePath)
  })
  const base = { kind: 'current-file' as const, key: CURRENT_FILE_ITEM_KEY, label }
  if (python) {
    const target = debugTargetForFile(launch.filePath, python.interpreter?.path)
    return {
      ...base,
      target: { ...python.runTarget, groupId },
      // Why only local: the debug adapter runs on this machine.
      debug: python.local && target ? { target, cwd: worktreePath } : null
    }
  }
  const target = debugTargetForFile(launch.filePath)
  if (target?.kind !== 'node-file') {
    return null
  }
  return {
    ...base,
    target: nodeFileRunTarget(worktreeId, groupId, launch.filePath, worktreePath),
    debug: { target, cwd: worktreePath }
  }
}
