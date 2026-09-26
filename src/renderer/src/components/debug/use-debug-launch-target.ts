import { useAppStore } from '@/store'
import { isDebuggableFile } from './debug-launch'

export type DebugLaunchTarget = { worktreeId: string; filePath: string }

/** The active editor file, when it is one the debugger can launch. */
export function useDebugLaunchTarget(): DebugLaunchTarget | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const filePath = useAppStore((s) => {
    const fileId = activeWorktreeId ? s.activeFileIdByWorktree[activeWorktreeId] : null
    const file = fileId ? s.openFiles.find((candidate) => candidate.id === fileId) : undefined
    return file?.mode === 'edit' ? file.filePath : null
  })
  if (!activeWorktreeId || !filePath || !isDebuggableFile(filePath)) {
    return null
  }
  return { worktreeId: activeWorktreeId, filePath }
}
