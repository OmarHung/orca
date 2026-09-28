import React, { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FilePen, GitBranch, LoaderCircle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from '../status-bar/status-bar-context-menu-policy'
import { summarizeBranchStatus, type BranchStatusSummary } from './branch-status-model'
import { normalizeGitAutoFetchIntervalMinutes } from './git-auto-fetch-schedule'
import { useGitAutoFetchStore } from './git-auto-fetch-store'
import { resolveActiveGitFetchTarget } from './git-auto-fetch-runner'
import { GitBranchStatusDetails } from './GitBranchStatusDetails'

export const GIT_BRANCH_STATUS_SETTINGS_SECTION_ID = 'git-branch-status'

function segmentAriaLabel(summary: BranchStatusSummary): string {
  return translate(
    'gitBranchStatus.ariaLabel',
    'Branch {{branch}}, {{ahead}} to push, {{behind}} to pull, {{changes}} changed files',
    {
      branch: summary.label,
      ahead: summary.ahead,
      behind: summary.behind,
      changes: summary.changedFileCount
    }
  )
}

function Count({
  icon: Icon,
  value
}: {
  icon: typeof ArrowUp
  value: string | number
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums">
      <Icon className="size-3" />
      {value}
    </span>
  )
}

/** GitToolBox-style status-bar segment: branch, ahead/behind and uncommitted changes. */
export function GitBranchStatusSegment({
  iconOnly
}: {
  iconOnly: boolean
}): React.JSX.Element | null {
  const worktree = useActiveWorktree()
  const repo = useRepoById(worktree?.repoId ?? null)
  const worktreeId = worktree?.id ?? null
  const enabled = useAppStore((s) => s.settings?.gitBranchStatusBarEnabled !== false)
  const autoFetchEnabled = useAppStore((s) => s.settings?.gitAutoFetchEnabled === true)
  const intervalMinutes = useAppStore((s) => s.settings?.gitAutoFetchIntervalMinutes)
  const entries = useAppStore((s) => (worktreeId ? s.gitStatusByWorktree[worktreeId] : undefined))
  const entriesArePartial = useAppStore((s) =>
    worktreeId ? Boolean(s.gitStatusHugeByWorktree[worktreeId]) : false
  )
  const statusHead = useAppStore((s) =>
    worktreeId ? s.gitStatusHeadByWorktree[worktreeId] : undefined
  )
  const upstream = useAppStore((s) =>
    worktreeId ? s.remoteStatusesByWorktree[worktreeId] : undefined
  )
  const isRemoteOperationActive = useAppStore((s) => s.isRemoteOperationActive)
  const isUserFetching = useAppStore((s) => s.inFlightRemoteOpKind === 'fetch')
  const repoId = repo?.id ?? null
  const autoFetchRecord = useGitAutoFetchStore((s) =>
    repoId ? s.recordsByRepo[repoId] : undefined
  )
  const autoFetchRunning = useGitAutoFetchStore((s) =>
    repoId ? Boolean(s.runningRepoIds[repoId]) : false
  )
  const [open, setOpen] = useState(false)
  // Why: relative times are read against the moment the details opened, not re-sampled per render.
  const [openedAt, setOpenedAt] = useState(0)

  const summary = useMemo(
    () =>
      summarizeBranchStatus({
        branch: worktree?.branch,
        head: worktree?.head ?? statusHead,
        entries,
        entriesArePartial,
        upstream
      }),
    [entries, entriesArePartial, statusHead, upstream, worktree?.branch, worktree?.head]
  )

  if (!enabled || !worktree || !repo || !isGitRepoKind(repo) || !summary) {
    return null
  }

  const isFetching = isUserFetching || autoFetchRunning
  const handleFetch = (): void => {
    const target = resolveActiveGitFetchTarget()
    if (!target) {
      return
    }
    void useAppStore
      .getState()
      .fetchBranch(target.worktreeId, target.worktreePath, target.connectionId, target.pushTarget, {
        runtimeTargetSettings: target.settings
      })
      // Why: fetchBranch already toasts the failure; this only keeps the rejection handled.
      .catch(() => {})
  }
  const handleOpenSourceControl = (): void => {
    const store = useAppStore.getState()
    store.setRightSidebarTab('source-control')
    store.setRightSidebarOpen(true)
    setOpen(false)
  }
  const handleOpenSettings = (): void => {
    const store = useAppStore.getState()
    store.openSettingsTarget({
      pane: 'git',
      repoId: null,
      sectionId: GIT_BRANCH_STATUS_SETTINGS_SECTION_ID
    })
    store.openSettingsPage()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpenedAt(Date.now())
        }
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
          data-testid="git-branch-status-segment"
          aria-label={segmentAriaLabel(summary)}
          className="inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {isFetching ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <GitBranch className="size-3.5 shrink-0" />
          )}
          {iconOnly ? null : <span className="max-w-40 truncate">{summary.label}</span>}
          {summary.ahead > 0 ? <Count icon={ArrowUp} value={summary.ahead} /> : null}
          {summary.behind > 0 ? <Count icon={ArrowDown} value={summary.behind} /> : null}
          {summary.changedFileCount > 0 ? (
            <Count
              icon={FilePen}
              value={
                summary.changedFileCountIsPartial
                  ? `${summary.changedFileCount}+`
                  : summary.changedFileCount
              }
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        className="w-80 max-w-[calc(100vw-2rem)]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <GitBranchStatusDetails
          summary={summary}
          now={openedAt}
          autoFetch={{
            enabled: autoFetchEnabled,
            intervalMinutes: normalizeGitAutoFetchIntervalMinutes(intervalMinutes),
            record: autoFetchRecord,
            running: autoFetchRunning
          }}
          canFetch={!isRemoteOperationActive && !autoFetchRunning}
          isFetching={isFetching}
          onFetch={handleFetch}
          onOpenSourceControl={handleOpenSourceControl}
          onOpenSettings={handleOpenSettings}
        />
      </PopoverContent>
    </Popover>
  )
}
