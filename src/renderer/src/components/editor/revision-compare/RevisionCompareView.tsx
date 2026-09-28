import React, { useEffect, useState } from 'react'
import { GitCompareArrows, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import { getRuntimeGitCommitDiff } from '@/runtime/runtime-git-client'
import type { OpenFile } from '@/store/slices/editor'
import { resolveRevisionCompareContext } from './revision-compare-context'
import { useRevisionCompareStore, type RevisionCompareBaseline } from './revision-compare-store'

const DiffViewer = lazy(() => import('../DiffViewer'))

type BaselineContent =
  | { key: string; status: 'loading' }
  | { key: string; status: 'ready'; content: string }
  | { key: string; status: 'unavailable'; message: string }

function useBaselineContent(file: OpenFile, baseline: RevisionCompareBaseline): BaselineContent {
  const key = `${file.worktreeId}\0${file.relativePath}\0${baseline.oid}`
  const [state, setState] = useState<BaselineContent>({ key, status: 'loading' })
  useEffect(() => {
    const context = resolveRevisionCompareContext(file.worktreeId)
    if (!context) {
      setState({
        key,
        status: 'unavailable',
        message: translate('revisionCompare.notGit', 'This file is not in a Git repository.')
      })
      return
    }
    let cancelled = false
    setState({ key, status: 'loading' })
    // Why commit == parent: both sides then read the file at the baseline; the live buffer is the other side.
    getRuntimeGitCommitDiff(context, {
      commitOid: baseline.oid,
      parentOid: baseline.oid,
      filePath: file.relativePath
    }).then(
      (diff) => {
        if (cancelled) {
          return
        }
        setState(
          diff.kind === 'text'
            ? { key, status: 'ready', content: diff.modifiedContent }
            : {
                key,
                status: 'unavailable',
                message: translate('revisionCompare.binary', 'Binary files cannot be compared.')
              }
        )
      },
      (error: unknown) =>
        !cancelled &&
        setState({
          key,
          status: 'unavailable',
          message: error instanceof Error ? error.message : String(error)
        })
    )
    return () => {
      cancelled = true
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Why: `key` covers the file and baseline it reads.
  }, [key])
  return state.key === key ? state : { key, status: 'loading' }
}

/** The editor file shown as an editable diff against the version picked from its context menu. */
export function RevisionCompareView({
  file,
  baseline,
  modifiedContent,
  language,
  sideBySide,
  viewStateScopeId,
  diffViewStateKey,
  onContentChange,
  onSave
}: {
  file: OpenFile
  baseline: RevisionCompareBaseline
  modifiedContent: string
  language: string
  sideBySide: boolean
  viewStateScopeId: string
  diffViewStateKey: string
  onContentChange: (content: string) => void
  onSave: (content: string) => Promise<boolean>
}): React.JSX.Element {
  const original = useBaselineContent(file, baseline)
  const clearBaseline = useRevisionCompareStore((s) => s.clearBaseline)
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="revision-compare-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
        <GitCompareArrows className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {translate('revisionCompare.banner', 'Comparing with {{label}} ({{sha}})', {
            label: baseline.label,
            sha: baseline.oid.slice(0, 7)
          })}
        </span>
        <Button variant="ghost" size="xs" onClick={() => clearBaseline(file.id)}>
          <X />
          {translate('revisionCompare.close', 'Close Comparison')}
        </Button>
      </div>
      {original.status === 'ready' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <DiffViewer
            key={`${viewStateScopeId}\0${baseline.oid}`}
            modelKey={diffViewStateKey}
            originalModelKey={`${diffViewStateKey}:revision:${baseline.oid}`}
            originalContent={original.content}
            modifiedContent={modifiedContent}
            language={language}
            filePath={file.filePath}
            relativePath={file.relativePath}
            sideBySide={sideBySide}
            editable={true}
            worktreeId={file.worktreeId}
            onContentChange={onContentChange}
            onSave={onSave}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {original.status === 'loading'
            ? translate('revisionCompare.loadingFile', 'Loading {{label}}…', {
                label: baseline.label
              })
            : original.message}
        </div>
      )}
    </div>
  )
}
