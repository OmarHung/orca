import React from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import CommentMarkdown from '../../sidebar/CommentMarkdown'
import type { ForkReleaseNote } from '../../../../../shared/fork-sync-status'

const GITHUB_RELEASE_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\//

// Why: compact markdown welds paragraphs and headings onto one line (as in the PR sidebar's
// MARKDOWN_BASE); release notes need block flow, at the card's smaller type scale.
const RELEASE_NOTES_MARKDOWN = cn(
  'text-xs text-muted-foreground',
  '[&_.comment-md-p]:block [&>*+*]:mt-2',
  '[&_.comment-md-h]:mt-3 [&_.comment-md-h]:mb-1 [&_.comment-md-h]:block [&_.comment-md-h]:leading-tight [&_.comment-md-h]:text-foreground [&_.comment-md-h:first-child]:mt-0',
  '[&_.comment-md-h1]:text-sm [&_.comment-md-h2]:text-sm'
)

/** The repo a release page belongs to, so `#123` in its notes links to that repo's PRs. */
export function releaseRepo(url: string): { owner: string; repo: string } | null {
  const match = GITHUB_RELEASE_URL.exec(url)
  return match ? { owner: match[1], repo: match[2] } : null
}

/** Upstream release notes between the fork's base and the offered tag, newest first. */
export function ForkReleaseNotes({
  notes,
  showHeading = true
}: {
  notes: ForkReleaseNote[]
  showHeading?: boolean
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5" data-testid="fork-sync-release-notes">
      {showHeading ? (
        <h4 className="text-xs font-medium">
          {translate('forkSync.releaseNotesTitle', "What's new upstream")}
        </h4>
      ) : null}
      <div className="scrollbar-sleek flex max-h-72 flex-col gap-4 overflow-y-auto rounded-md border border-border p-2.5">
        {notes.map((note) => (
          <article key={note.tag} className="flex flex-col gap-1">
            <button
              type="button"
              className="self-start text-xs font-semibold underline-offset-2 hover:underline"
              onClick={() => void window.api.shell.openUrl(note.url)}
            >
              {note.title}
            </button>
            <CommentMarkdown
              content={note.body}
              githubRepo={releaseRepo(note.url)}
              className={RELEASE_NOTES_MARKDOWN}
            />
          </article>
        ))}
      </div>
    </section>
  )
}
