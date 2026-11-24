import { getDefaultSettings } from '../../../../../../shared/orca-profiles/constants'
import type { ClaudeManagedAccount } from '../../../../../../shared/agent-accounts/managed-account-types'
import type { Repo } from '../../../../../../shared/repository/repo-types'
import type { Tab } from '../../../../../../shared/workspace-layout/tab-groups/tab-types'
import { defineFixture } from '../../../../component-fixtures/component-fixture'
import { NativeChatComposerClaudeAccountPicker } from './NativeChatComposerClaudeAccountPicker'

function account(id: string): ClaudeManagedAccount {
  return {
    id,
    email: `${id}@example.test`,
    managedAuthPath: `/fixture/${id}`,
    authMethod: 'subscription-oauth',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  }
}

const repo: Repo = {
  id: 'repo-1',
  path: '/repos/acme-web',
  displayName: 'acme-web',
  badgeColor: '#3b82f6',
  addedAt: 0,
  claudeAccountId: 'team'
}

const WORKTREE = 'repo-1::/repos/acme-web'

const chatTab: Tab = {
  id: 'chat-tab',
  entityId: 'chat-session',
  groupId: 'group',
  worktreeId: WORKTREE,
  executionHostId: 'local',
  contentType: 'agent-session',
  label: 'Claude Chat',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 0,
  agentSessionAgent: 'claude'
}

function fixture(open: boolean) {
  return defineFixture({
    width: 360,
    store: {
      repos: [repo],
      unifiedTabsByWorktree: { [WORKTREE]: [chatTab] },
      settings: {
        ...getDefaultSettings('/home/fixture'),
        claudeManagedAccounts: [account('alice'), account('team')],
        activeClaudeManagedAccountId: 'alice'
      }
    },
    ...(open
      ? {
          interact: (frame: HTMLElement) => {
            frame
              .querySelector('button')
              ?.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
              )
          }
        }
      : {}),
    render: () => (
      <div className="flex h-5.5 items-center justify-end px-3 text-2xs text-chat-foreground-faint">
        <NativeChatComposerClaudeAccountPicker
          chat={{ tabId: chatTab.id, worktreeId: WORKTREE }}
          repoId="repo-1"
          textClassName="min-w-0 overflow-x-clip text-ellipsis text-2xs whitespace-nowrap"
        />
      </div>
    )
  })
}

export const closed = fixture(false)
export const open = fixture(true)
