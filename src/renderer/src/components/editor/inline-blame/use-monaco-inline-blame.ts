import { useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { createInlineBlameController, type InlineBlameController } from './inline-blame-controller'
import { loadInlineBlame, openInlineBlameCommit } from './inline-blame-source'

/**
 * Current-line blame for a worktree file. `relativePath` null turns it off
 * (untitled and out-of-worktree files, read-only views). Re-blames when HEAD
 * moves, since that is when committed lines change owners.
 */
export function useMonacoInlineBlame(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  worktreeId: string | undefined,
  relativePath: string | null
): void {
  const enabled = useAppStore((s) => s.settings?.gitInlineBlameEnabled !== false)
  const headKey = useAppStore((s) =>
    worktreeId ? (s.gitStatusHeadByWorktree[worktreeId] ?? '') : ''
  )
  const [controller, setController] = useState<InlineBlameController | null>(null)

  useEffect(() => {
    if (!mountedEditor || !enabled || !worktreeId || !relativePath) {
      return
    }
    const created = createInlineBlameController(mountedEditor, (sha, summary) => {
      void openInlineBlameCommit(worktreeId, sha, summary)
    })
    setController(created)
    return () => {
      created.dispose()
      setController(null)
    }
  }, [enabled, mountedEditor, relativePath, worktreeId])

  useEffect(() => {
    if (!controller || !worktreeId || !relativePath) {
      return
    }
    let cancelled = false
    void loadInlineBlame(worktreeId, relativePath, headKey).then((result) => {
      if (!cancelled) {
        controller.setBlame(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [controller, headKey, relativePath, worktreeId])
}
