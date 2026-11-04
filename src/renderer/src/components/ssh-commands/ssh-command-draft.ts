import {
  findQuotedSshCommandKeys,
  literalBraceTokens,
  syncSshCommandParams
} from '../../../../shared/ssh-command-template'
import {
  sshCommandDraftSchema,
  type SshCommand,
  type SshCommandDraft
} from '../../../../shared/ssh-command-types'
import type { TerminalQuickCommand } from '../../../../shared/terminal-quick-command-types'

export const EMPTY_SSH_COMMAND_DRAFT: SshCommandDraft = {
  name: '',
  template: '',
  params: [],
  runMode: 'insert',
  scope: { type: 'all' }
}

export type SshCommandDraftProblem =
  | { kind: 'emptyName' | 'emptyTemplate' | 'unsafeTemplate' | 'noHosts' | 'noGroup' }
  | { kind: 'noOptions' | 'defaultNotAnOption' | 'quotedKey'; key: string }

export type SshCommandDraftReview = {
  /** Any entry here means the draft can't be saved. */
  problems: SshCommandDraftProblem[]
  /** `{{...}}` that isn't a parameter and goes out as written. */
  literalTokens: string[]
  unusedKeys: string[]
}

function usesShellQuoting(draft: SshCommandDraft, key: string): boolean {
  return draft.params.find((param) => param.key === key)?.quote !== 'raw'
}

export function reviewSshCommandDraft(draft: SshCommandDraft): SshCommandDraftReview {
  const problems: SshCommandDraftProblem[] = []
  if (draft.name.trim() === '') {
    problems.push({ kind: 'emptyName' })
  }
  if (draft.template.trim() === '') {
    problems.push({ kind: 'emptyTemplate' })
  } else if (!sshCommandDraftSchema.shape.template.safeParse(draft.template).success) {
    problems.push({ kind: 'unsafeTemplate' })
  }
  if (draft.scope.type === 'hosts' && draft.scope.targetIds.length === 0) {
    problems.push({ kind: 'noHosts' })
  }
  if (draft.scope.type === 'group' && draft.scope.groupId === '') {
    problems.push({ kind: 'noGroup' })
  }
  const { unusedKeys } = syncSshCommandParams(draft.template, draft.params)
  for (const param of draft.params) {
    if (param.kind !== 'select' || unusedKeys.includes(param.key)) {
      continue
    }
    const options = param.options ?? []
    if (options.length === 0) {
      problems.push({ kind: 'noOptions', key: param.key })
    } else if (param.defaultValue !== '' && !options.includes(param.defaultValue)) {
      problems.push({ kind: 'defaultNotAnOption', key: param.key })
    }
  }
  for (const key of findQuotedSshCommandKeys(draft.template)) {
    if (usesShellQuoting(draft, key)) {
      problems.push({ kind: 'quotedKey', key })
    }
  }
  return {
    problems,
    literalTokens: literalBraceTokens(draft.template),
    unusedKeys
  }
}

/** Quick Commands that send text and aren't saved here yet. Agent prompts have no shell text. */
export function quickCommandsToSshDrafts(
  quickCommands: readonly TerminalQuickCommand[],
  existing: readonly SshCommand[]
): SshCommandDraft[] {
  const seen = new Set(existing.map((command) => `${command.name}\0${command.template}`))
  const drafts: SshCommandDraft[] = []
  for (const quickCommand of quickCommands) {
    if (quickCommand.action === 'agent-prompt') {
      continue
    }
    const name = quickCommand.label.trim()
    const template = quickCommand.command.trim()
    const key = `${name}\0${template}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const draft: SshCommandDraft = {
      name,
      template,
      params: syncSshCommandParams(template, []).params,
      runMode: quickCommand.appendEnter ? 'run' : 'insert',
      scope: { type: 'all' }
    }
    if (sshCommandDraftSchema.safeParse(draft).success) {
      drafts.push(draft)
    }
  }
  return drafts
}
