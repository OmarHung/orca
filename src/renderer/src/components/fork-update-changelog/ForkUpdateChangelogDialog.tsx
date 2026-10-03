import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import { ForkReleaseNotes, releaseRepo } from '../maintenance/update-card/ForkReleaseNotes'
import type {
  ForkChangelogCommit,
  ForkUpdateChangelog
} from '../../../../shared/fork-update-changelog'
import {
  getForkUpdateChangelogApi,
  useForkUpdateChangelogStore
} from './fork-update-changelog-store'

// Why: compact markdown welds paragraphs and headings onto one line; a summary needs block flow.
const SUMMARY_MARKDOWN = cn(
  'text-sm text-foreground',
  '[&_.comment-md-p]:block [&>*+*]:mt-2',
  '[&_.comment-md-h]:mt-4 [&_.comment-md-h]:mb-1 [&_.comment-md-h]:block [&_.comment-md-h]:font-semibold [&_.comment-md-h:first-child]:mt-0',
  '[&_.comment-md-h1]:text-base [&_.comment-md-h2]:text-sm'
)

function SummarySection({
  changelog,
  onRegenerate
}: {
  changelog: ForkUpdateChangelog
  onRegenerate: () => void
}): React.JSX.Element {
  const summary = changelog.summary
  if (summary?.status === 'ready') {
    return (
      <CommentMarkdown
        content={summary.markdown}
        githubRepo={changelog.releaseNotes[0] ? releaseRepo(changelog.releaseNotes[0].url) : null}
        className={SUMMARY_MARKDOWN}
      />
    )
  }
  if (summary?.status === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
        <p className="font-medium text-foreground">
          {translate('forkUpdateChangelog.failed', 'Could not summarize the changes.')}
        </p>
        <p className="break-words font-mono text-muted-foreground">{summary.error}</p>
        <Button size="sm" variant="outline" onClick={onRegenerate}>
          <RefreshCw />
          {translate('forkUpdateChangelog.retry', 'Try again')}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {translate('forkUpdateChangelog.generating', 'Summarizing the changes with AI…')}
    </div>
  )
}

function DetailsSection({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="-ml-1.5">
          {isOpen ? <ChevronDown /> : <ChevronRight />}
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function ForkCommitList({ commits }: { commits: ForkChangelogCommit[] }): React.JSX.Element {
  return (
    <ul className="scrollbar-sleek flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2.5 text-xs">
      {commits.map((commit) => (
        <li key={commit.sha} className="flex gap-2">
          <span className="shrink-0 font-mono text-muted-foreground">{commit.sha.slice(0, 7)}</span>
          <span className="min-w-0 break-words">{commit.subject}</span>
        </li>
      ))}
    </ul>
  )
}

/** "What's new" after a fork build updated to a new upstream tag, summarized by an AI agent. */
export function ForkUpdateChangelogDialog({
  changelog,
  locale
}: {
  changelog: ForkUpdateChangelog
  /** Null until settings load; regenerating waits for it. */
  locale: string | null
}): React.JSX.Element {
  const closeDialog = useForkUpdateChangelogStore((s) => s.closeDialog)
  const summary = changelog.summary
  const isGenerating = summary === null || summary.status === 'generating'
  const regenerate = (): void => {
    if (locale) {
      void getForkUpdateChangelogApi()?.regenerate(locale)
    }
  }
  const close = (): void => {
    closeDialog()
    void getForkUpdateChangelogApi()?.markSeen()
  }
  const forkCommits = changelog.forkCommits ?? []

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
    >
      <DialogContent className="max-h-[min(760px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate('forkUpdateChangelog.title', 'Orca updated to {{value0}}', {
              value0: changelog.toTag
            })}
          </DialogTitle>
          <DialogDescription>
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0" />
              {summary?.status === 'ready'
                ? translate(
                    'forkUpdateChangelog.descriptionReady',
                    'Changes since {{value0}}, summarized by {{value1}}',
                    { value0: changelog.fromTag, value1: summary.agentLabel }
                  )
                : translate('forkUpdateChangelog.description', 'Changes since {{value0}}', {
                    value0: changelog.fromTag
                  })}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-sleek -mr-2 flex min-h-0 flex-col gap-4 overflow-y-auto pr-2">
          <SummarySection changelog={changelog} onRegenerate={regenerate} />
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            {changelog.releaseNotes.length > 0 ? (
              <DetailsSection
                label={translate(
                  'forkUpdateChangelog.releaseNotes',
                  'Upstream release notes ({{value0}})',
                  { value0: changelog.releaseNotes.length }
                )}
              >
                <ForkReleaseNotes notes={changelog.releaseNotes} showHeading={false} />
              </DetailsSection>
            ) : null}
            {forkCommits.length > 0 ? (
              <DetailsSection
                label={translate('forkUpdateChangelog.forkCommits', 'Fork commits ({{value0}})', {
                  value0: forkCommits.length
                })}
              >
                <ForkCommitList commits={forkCommits} />
              </DetailsSection>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isGenerating} onClick={regenerate}>
            <RefreshCw />
            {translate('forkUpdateChangelog.regenerate', 'Summarize again')}
          </Button>
          <Button autoFocus onClick={close}>
            {translate('forkUpdateChangelog.done', 'Got it')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
