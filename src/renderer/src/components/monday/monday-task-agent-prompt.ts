import { translate } from '@/i18n/i18n'
import { LINKED_CONTEXT_BLOCK_MAX_CHARS } from '@/lib/linked-work-item-context'
import type {
  MondayBoardSchedule,
  MondayItemColumnValue,
  MondayItemDetail,
  MondayItemRelation,
  MondayUpdate,
  MondayUpdateReply
} from '../../../../shared/monday/monday-types'
import type { MondayCalendarEntry } from './monday-calendar-model'
import { formatMondayTimestamp } from './monday-date-format'
import { mondayHtmlToText } from './monday-update-html'
import { isMondayWebAddress } from './MondayColumnValue'

export type MondayTaskAgentPromptInput = {
  detail: MondayItemDetail
  /** The task as the schedule drew it; null when it is not on the loaded schedule. */
  entry: MondayCalendarEntry | null
  board: MondayBoardSchedule | null
}

function field(label: string, value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? `${label}: ${text}` : null
}

function lines(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join('\n')
}

function scheduleFields(entry: MondayCalendarEntry): (string | null)[] {
  const { schedule, item } = entry
  return [
    field(
      translate('monday.detail.timeline', 'Timeline'),
      schedule.span ? `${schedule.span.from} → ${schedule.span.to}` : null
    ),
    field(translate('monday.detail.due', 'Due date'), schedule.due),
    field(translate('monday.detail.status', 'Status'), item.status?.label),
    field(translate('monday.detail.priority', 'Priority'), item.priority?.label),
    field(translate('monday.detail.people', 'People'), item.peopleText)
  ]
}

/** Without a schedule entry the role columns are not shown above, so every column is listed. */
function columnFields(input: MondayTaskAgentPromptInput): (string | null)[] {
  const shown = new Set(input.entry ? Object.values(input.board?.roles ?? {}) : [])
  return input.detail.columns
    .filter((column) => !shown.has(column.id))
    .map((column) => field(column.title, column.text))
}

function webAddresses(columns: readonly MondayItemColumnValue[]): string[] {
  return columns.filter((column) => isMondayWebAddress(column.text)).map((column) => column.text)
}

/** Linked records carry only their links: their other columns can hold logins. */
function relationFields(relations: readonly MondayItemRelation[]): (string | null)[] {
  return relations.flatMap((relation) =>
    relation.items.map((item) =>
      field(relation.title, [item.name, item.url, ...webAddresses(item.columns)].join(' '))
    )
  )
}

function postText(post: MondayUpdateReply, imageLabel: string): string {
  const heading = [post.creatorName, formatMondayTimestamp(post.createdAt)]
    .filter(Boolean)
    .join(' · ')
  return `[${heading}]\n${mondayHtmlToText(post.bodyHtml, imageLabel)}`
}

function updateText(update: MondayUpdate, imageLabel: string): string {
  const replies = update.replies.map((reply) =>
    postText(reply, imageLabel)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
  )
  return [postText(update, imageLabel), ...replies].join('\n')
}

function section(title: string, body: string): string | null {
  return body.trim() ? `${title}\n${body}` : null
}

function isUnsafeCodePoint(code: number): boolean {
  return (
    (code <= 0x1f && code !== 0x0a) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

// Why: the prompt is pasted into an agent's terminal, where escape sequences in other
// people's text could act on the TUI, and bidi controls could hide what is pasted.
function stripUnsafeCharacters(text: string): string {
  return Array.from(text.replace(/\r\n?/g, '\n').replace(/\t/g, '  '))
    .filter((char) => !isUnsafeCodePoint(char.codePointAt(0) ?? 0))
    .join('')
}

function capLength(text: string): string {
  if (text.length <= LINKED_CONTEXT_BLOCK_MAX_CHARS) {
    return text
  }
  const marker = translate(
    'monday.agent.prompt.truncated',
    '[Too long, the rest is left out. The monday link above has everything.]'
  )
  return `${text.slice(0, LINKED_CONTEXT_BLOCK_MAX_CHARS - marker.length - 1).trimEnd()}\n${marker}`
}

/** What a monday task hands an agent: the fields, description, subitems and update threads. */
export function buildMondayTaskAgentPrompt(input: MondayTaskAgentPromptInput): string {
  const { detail, entry } = input
  const imageLabel = translate('monday.detail.imageLink', '[Image]')
  // Newest first, like monday: the length cap then drops the oldest threads.
  const updates = [...detail.updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const sections = [
    translate('monday.agent.prompt.intro', 'Please work on this monday task:'),
    lines([
      field(translate('monday.agent.prompt.task', 'Task'), detail.name),
      field(
        translate('monday.agent.prompt.board', 'Board'),
        [detail.boardName, detail.groupTitle].filter(Boolean).join(' · ')
      ),
      field(translate('monday.agent.prompt.link', 'monday link'), detail.url),
      ...(entry ? scheduleFields(entry) : []),
      ...columnFields(input),
      ...relationFields(detail.relations)
    ]),
    detail.descriptionText
      ? section(translate('monday.detail.description', 'Description'), detail.descriptionText)
      : null,
    section(
      translate('monday.agent.prompt.subitems', 'Subitems'),
      detail.subitems
        .map((subitem) =>
          subitem.statusText ? `- ${subitem.name} (${subitem.statusText})` : `- ${subitem.name}`
        )
        .join('\n')
    ),
    section(
      translate('monday.agent.prompt.updates', 'Updates (newest first)'),
      updates.map((update) => updateText(update, imageLabel)).join('\n\n')
    )
  ]
  const text = sections.filter((part): part is string => Boolean(part?.trim())).join('\n\n')
  return capLength(stripUnsafeCharacters(text).replace(/\n{3,}/g, '\n\n'))
}
