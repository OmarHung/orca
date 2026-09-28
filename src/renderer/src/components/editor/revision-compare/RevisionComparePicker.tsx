import React, { useEffect, useState } from 'react'
import { GitBranch, GitCommitHorizontal, Star } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { getRuntimeGitHistory } from '@/runtime/runtime-git-client'
import type { GitHistoryBranch, GitHistoryItem } from '../../../../../shared/git-history'
import { resolveRevisionCompareContext } from './revision-compare-context'
import {
  useRevisionCompareStore,
  type RevisionComparePickerRequest
} from './revision-compare-store'

const REVISION_LIMIT = 100
const SHORT_SHA_LENGTH = 7

type PickerData =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'branches'; branches: GitHistoryBranch[] }
  | { status: 'revisions'; items: GitHistoryItem[]; fileScoped: boolean; loadedAt: number }

async function loadPickerData(request: RevisionComparePickerRequest): Promise<PickerData> {
  const context = resolveRevisionCompareContext(request.worktreeId)
  if (!context) {
    return {
      status: 'error',
      error: translate('revisionCompare.notGit', 'This file is not in a Git repository.')
    }
  }
  if (request.mode === 'branch') {
    const result = await getRuntimeGitHistory(context, { includeRefs: true, limit: 1 })
    if (!result.refs) {
      return {
        status: 'error',
        error: translate(
          'revisionCompare.hostTooOld',
          'Update Orca on this host to list its branches.'
        )
      }
    }
    return { status: 'branches', branches: result.refs.branches }
  }
  const result = await getRuntimeGitHistory(context, {
    path: request.relativePath,
    limit: REVISION_LIMIT
  })
  return {
    status: 'revisions',
    items: result.items,
    fileScoped: result.path === request.relativePath,
    loadedAt: Date.now()
  }
}

function usePickerData(request: RevisionComparePickerRequest | null): PickerData {
  const [data, setData] = useState<PickerData>({ status: 'loading' })
  useEffect(() => {
    if (!request) {
      return
    }
    let cancelled = false
    setData({ status: 'loading' })
    loadPickerData(request).then(
      (next) => !cancelled && setData(next),
      (error: unknown) =>
        !cancelled &&
        setData({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    )
    return () => {
      cancelled = true
    }
  }, [request])
  return data
}

function BranchItems({
  branches,
  onPick
}: {
  branches: GitHistoryBranch[]
  onPick: (oid: string, label: string) => void
}): React.JSX.Element {
  const groups = [
    {
      key: 'local',
      heading: translate('bottomPanel.gitLog.localBranches', 'Local'),
      items: branches.filter((branch) => branch.kind === 'local')
    },
    {
      key: 'remote',
      heading: translate('bottomPanel.gitLog.remoteBranches', 'Remote'),
      items: branches.filter((branch) => branch.kind === 'remote')
    }
  ]
  return (
    <>
      {groups.map((group) =>
        group.items.length > 0 ? (
          <CommandGroup key={group.key} heading={group.heading}>
            {group.items.map((branch) => (
              <CommandItem
                key={branch.fullName}
                value={branch.fullName}
                onSelect={() => onPick(branch.revision, branch.name)}
              >
                {branch.isHead ? <Star className="text-git-graph-ref" /> : <GitBranch />}
                <span className="truncate">{branch.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null
      )}
    </>
  )
}

function RevisionItems({
  items,
  fileScoped,
  now,
  onPick
}: {
  items: GitHistoryItem[]
  fileScoped: boolean
  /** Reference time for the relative dates, taken when the list loaded. */
  now: number
  onPick: (oid: string, label: string) => void
}): React.JSX.Element {
  return (
    <CommandGroup
      heading={
        fileScoped
          ? translate('revisionCompare.fileHistory', 'Commits that changed this file')
          : translate('revisionCompare.recentCommits', 'Recent commits')
      }
    >
      {items.map((item) => (
        <CommandItem
          key={item.id}
          value={`${item.id} ${item.subject} ${item.author ?? ''}`}
          className="items-start"
          onSelect={() => onPick(item.id, item.id.slice(0, SHORT_SHA_LENGTH))}
        >
          <GitCommitHorizontal className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{item.subject}</span>
            <span className="block truncate text-xs text-muted-foreground">
              <span className="font-mono">{item.id.slice(0, SHORT_SHA_LENGTH)}</span>
              {item.author ? ` · ${item.author}` : ''}
              {item.timestamp ? ` · ${formatUiRelativeTime(item.timestamp - now)}` : ''}
            </span>
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/** App-wide picker behind the editor's "Git: Compare with Branch/Revision…" actions. */
export function RevisionComparePicker(): React.JSX.Element {
  const request = useRevisionCompareStore((s) => s.pickerRequest)
  const closePicker = useRevisionCompareStore((s) => s.closePicker)
  const data = usePickerData(request)
  const pick = (oid: string, label: string): void => {
    if (request) {
      useRevisionCompareStore.getState().setBaseline(request.fileId, { oid, label })
    }
    closePicker()
  }
  const isBranchMode = request?.mode === 'branch'
  return (
    <CommandDialog
      open={request !== null}
      onOpenChange={(open) => !open && closePicker()}
      title={
        isBranchMode
          ? translate('revisionCompare.branchTitle', 'Compare with Branch')
          : translate('revisionCompare.revisionTitle', 'Compare with Revision')
      }
      description={translate(
        'revisionCompare.description',
        'Show this file as a diff against another version.'
      )}
      contentClassName="w-[560px]"
    >
      <CommandInput
        placeholder={
          isBranchMode
            ? translate('revisionCompare.searchBranches', 'Search branches…')
            : translate('revisionCompare.searchRevisions', 'Search by message, hash or author…')
        }
      />
      <CommandList>
        <CommandEmpty>
          {data.status === 'loading'
            ? translate('revisionCompare.loading', 'Loading…')
            : data.status === 'error'
              ? data.error
              : translate('revisionCompare.noMatches', 'No matches.')}
        </CommandEmpty>
        {data.status === 'branches' ? <BranchItems branches={data.branches} onPick={pick} /> : null}
        {data.status === 'revisions' ? (
          <RevisionItems
            items={data.items}
            fileScoped={data.fileScoped}
            now={data.loadedAt}
            onPick={pick}
          />
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
