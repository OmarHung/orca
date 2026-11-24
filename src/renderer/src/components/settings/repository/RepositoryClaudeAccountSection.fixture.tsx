import { getDefaultSettings } from '../../../../../shared/orca-profiles/constants'
import type { ClaudeManagedAccount } from '../../../../../shared/agent-accounts/managed-account-types'
import type { Repo } from '../../../../../shared/repository/repo-types'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { RepositoryClaudeAccountSection } from './RepositoryClaudeAccountSection'

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

function fixture(claudeAccountId?: string) {
  const repo: Repo = {
    id: 'repo-1',
    path: '/repos/acme-web',
    displayName: 'acme-web',
    badgeColor: '#3b82f6',
    addedAt: 0,
    ...(claudeAccountId ? { claudeAccountId } : {})
  }
  return defineFixture({
    width: 560,
    store: {
      settings: {
        ...getDefaultSettings('/home/fixture'),
        claudeManagedAccounts: [account('alice'), account('team')],
        activeClaudeManagedAccountId: 'alice',
        managedAccountDisplayNames: { claude: { team: 'Team plan' } }
      }
    },
    render: () => <RepositoryClaudeAccountSection repo={repo} updateRepo={() => {}} />
  })
}

export const inherit = fixture()
export const pinned = fixture('team')
export const removed = fixture('gone')
