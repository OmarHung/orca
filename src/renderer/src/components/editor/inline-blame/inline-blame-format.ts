import { getIntlLocale, translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { GIT_BLAME_UNCOMMITTED_SHA, type GitBlameCommit } from '../../../../../shared/git-blame'

const MAX_SUMMARY_LENGTH = 72
const SHORT_SHA_LENGTH = 7

/** A buffer line's blame: its commit, or null when the line is not committed yet. */
export type InlineBlameLine = GitBlameCommit | null

export function isUncommittedBlame(commit: InlineBlameLine): commit is null {
  return commit === null
}

export function toInlineBlameLine(commit: GitBlameCommit | undefined): InlineBlameLine {
  return !commit || commit.sha === GIT_BLAME_UNCOMMITTED_SHA ? null : commit
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The grey text after the caret line, e.g. "Alice, 3 days ago • Fix the parser". */
export function formatInlineBlameAnnotation(line: InlineBlameLine, now: number): string {
  if (isUncommittedBlame(line)) {
    return translate('inlineBlame.uncommitted', 'Uncommitted changes')
  }
  const when = formatUiRelativeTime(line.authorTime * 1000 - now)
  return `${line.author}, ${when} • ${truncate(line.summary, MAX_SUMMARY_LENGTH)}`
}

function formatAbsoluteDate(date: Date): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&')
}

function commandLink(label: string, command: string, args: unknown[]): string {
  return `[${escapeMarkdown(label)}](command:${command}?${encodeURIComponent(JSON.stringify(args))})`
}

export const INLINE_BLAME_OPEN_COMMIT_COMMAND = 'orca.inlineBlame.openCommit'
export const INLINE_BLAME_COPY_SHA_COMMAND = 'orca.inlineBlame.copySha'

/** Hover card markdown for a committed line, with command links back into Orca. */
export function formatInlineBlameHover(
  commit: GitBlameCommit,
  now: number,
  modelUri: string
): string {
  const date = new Date(commit.authorTime * 1000)
  const when = formatUiRelativeTime(date.getTime() - now)
  const author = commit.authorMail
    ? `**${escapeMarkdown(commit.author)}** ${escapeMarkdown(`<${commit.authorMail}>`)}`
    : `**${escapeMarkdown(commit.author)}**`
  const actions = [
    `\`${commit.sha.slice(0, SHORT_SHA_LENGTH)}\``,
    commandLink(
      translate('inlineBlame.openChanges', 'Open Changes'),
      INLINE_BLAME_OPEN_COMMIT_COMMAND,
      [modelUri, commit.sha]
    ),
    commandLink(translate('inlineBlame.copySha', 'Copy Hash'), INLINE_BLAME_COPY_SHA_COMMAND, [
      commit.sha
    ])
  ]
  return [
    `${author}, ${escapeMarkdown(when)} (${escapeMarkdown(formatAbsoluteDate(date))})`,
    escapeMarkdown(commit.summary),
    actions.join(' · ')
  ].join('\n\n')
}
