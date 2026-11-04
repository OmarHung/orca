import { describe, expect, it } from 'vitest'
import type { SshCommandDraft, SshCommandParam } from '../../../../shared/ssh-command-types'
import {
  EMPTY_SSH_COMMAND_DRAFT,
  quickCommandsToSshDrafts,
  reviewSshCommandDraft
} from './ssh-command-draft'
import { sshCommandAppliesToTarget } from './ssh-command-scope'

const DRAFT: SshCommandDraft = { ...EMPTY_SSH_COMMAND_DRAFT, name: 'List', template: 'ls {{dir}}' }

const PARAM: SshCommandParam = {
  key: 'dir',
  label: 'Folder',
  kind: 'text',
  defaultValue: '',
  required: true,
  quote: 'shell'
}

describe('reviewSshCommandDraft', () => {
  it('accepts a complete draft', () => {
    expect(reviewSshCommandDraft({ ...DRAFT, params: [PARAM] }).problems).toEqual([])
  })

  it('needs a name and a template', () => {
    expect(reviewSshCommandDraft(EMPTY_SSH_COMMAND_DRAFT).problems).toEqual([
      { kind: 'emptyName' },
      { kind: 'emptyTemplate' }
    ])
  })

  it('refuses a template that could drive the terminal', () => {
    expect(reviewSshCommandDraft({ ...DRAFT, template: 'a\u001b[0m' }).problems).toEqual([
      { kind: 'unsafeTemplate' }
    ])
  })

  it('needs a host or a group when the scope names them', () => {
    const noHosts = { ...DRAFT, scope: { type: 'hosts' as const, targetIds: [] } }
    const noGroup = { ...DRAFT, scope: { type: 'group' as const, groupId: '' } }

    expect(reviewSshCommandDraft(noHosts).problems).toEqual([{ kind: 'noHosts' }])
    expect(reviewSshCommandDraft(noGroup).problems).toEqual([{ kind: 'noGroup' }])
  })

  it('needs options for a select, and a default that is one of them', () => {
    const select = { ...PARAM, kind: 'select' as const }

    expect(reviewSshCommandDraft({ ...DRAFT, params: [select] }).problems).toEqual([
      { kind: 'noOptions', key: 'dir' }
    ])
    expect(
      reviewSshCommandDraft({
        ...DRAFT,
        params: [{ ...select, options: ['a'], defaultValue: 'b' }]
      }).problems
    ).toEqual([{ kind: 'defaultNotAnOption', key: 'dir' }])
  })

  it('does not block saving over a parameter no longer in the template', () => {
    const unused = { ...PARAM, key: 'old', kind: 'select' as const }

    const review = reviewSshCommandDraft({ ...DRAFT, template: 'ls', params: [unused] })

    expect(review.problems).toEqual([])
    expect(review.unusedKeys).toEqual(['old'])
  })

  it('refuses a parameter in quotes, unless it is inserted as written', () => {
    const template = 'grep "{{dir}}"'

    expect(reviewSshCommandDraft({ ...DRAFT, template, params: [PARAM] }).problems).toEqual([
      { kind: 'quotedKey', key: 'dir' }
    ])
    expect(
      reviewSshCommandDraft({ ...DRAFT, template, params: [{ ...PARAM, quote: 'raw' }] }).problems
    ).toEqual([])
  })

  it('refuses a built-in value in quotes, since a file name could close them', () => {
    expect(reviewSshCommandDraft({ ...DRAFT, template: 'cat "{{selected}}"' }).problems).toEqual([
      { kind: 'quotedKey', key: 'selected' }
    ])
  })

  it('points out double braces that are not parameters', () => {
    const template = "docker ps --format '{{.Names}}'"

    expect(reviewSshCommandDraft({ ...DRAFT, template }).literalTokens).toEqual(['{{.Names}}'])
  })
})

describe('quickCommandsToSshDrafts', () => {
  const quick = {
    id: 'q1',
    label: 'Uptime',
    command: 'uptime',
    appendEnter: true
  }

  it('keeps the name, the text and whether it presses Enter', () => {
    expect(quickCommandsToSshDrafts([quick], [])).toEqual([
      { name: 'Uptime', template: 'uptime', params: [], runMode: 'run', scope: { type: 'all' } }
    ])
    expect(quickCommandsToSshDrafts([{ ...quick, appendEnter: false }], [])[0].runMode).toBe(
      'insert'
    )
  })

  it('skips agent prompts, which have no shell text', () => {
    const agent = {
      id: 'a',
      label: 'Ask',
      action: 'agent-prompt' as const,
      agent: 'claude' as const,
      prompt: 'hello'
    }

    expect(quickCommandsToSshDrafts([agent], [])).toEqual([])
  })

  it('skips what was imported before, so importing twice adds nothing', () => {
    const existing = [{ ...EMPTY_SSH_COMMAND_DRAFT, id: 'x', name: 'Uptime', template: 'uptime' }]

    expect(quickCommandsToSshDrafts([quick, quick], existing)).toEqual([])
    expect(quickCommandsToSshDrafts([quick, quick], [])).toHaveLength(1)
  })

  it('turns double-brace names into parameters, so they get filled in rather than sent', () => {
    const [draft] = quickCommandsToSshDrafts([{ ...quick, command: 'ls {{dir}}' }], [])

    expect(draft.params.map((param) => param.key)).toEqual(['dir'])
  })

  it('leaves out a command with no name, which could not be saved', () => {
    expect(quickCommandsToSshDrafts([{ ...quick, label: '  ' }], [])).toEqual([])
  })
})

describe('sshCommandAppliesToTarget', () => {
  const groups = {
    groups: [
      { id: 'prod', name: 'Prod', parentId: null },
      { id: 'prod-web', name: 'Web', parentId: 'prod' }
    ],
    hostGroups: { 'host-1': 'prod-web', 'host-2': 'other' },
    collapsed: []
  }

  it('covers every host when the scope is all', () => {
    expect(sshCommandAppliesToTarget({ type: 'all' }, 'host-9', groups)).toBe(true)
  })

  it('covers only the named hosts', () => {
    const scope = { type: 'hosts' as const, targetIds: ['host-1'] }

    expect(sshCommandAppliesToTarget(scope, 'host-1', groups)).toBe(true)
    expect(sshCommandAppliesToTarget(scope, 'host-2', groups)).toBe(false)
  })

  it('covers a group and the groups nested in it', () => {
    const scope = { type: 'group' as const, groupId: 'prod' }

    expect(sshCommandAppliesToTarget(scope, 'host-1', groups)).toBe(true)
    expect(sshCommandAppliesToTarget(scope, 'host-2', groups)).toBe(false)
    expect(sshCommandAppliesToTarget(scope, 'ungrouped', groups)).toBe(false)
  })

  it('covers nothing once the group is gone', () => {
    const scope = { type: 'group' as const, groupId: 'deleted' }

    expect(sshCommandAppliesToTarget(scope, 'host-1', groups)).toBe(false)
  })
})
