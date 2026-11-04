import type { SshCommandScope } from '../../../../shared/ssh-command-types'
import {
  sshHostGroupIdOf,
  sshHostGroupSubtreeIds,
  type SshHostGroupsData
} from '../ssh-page/ssh-host-groups'

/** A group's scope covers the groups nested in it. A deleted group matches no host. */
export function sshCommandAppliesToTarget(
  scope: SshCommandScope,
  targetId: string,
  groups: SshHostGroupsData
): boolean {
  switch (scope.type) {
    case 'all':
      return true
    case 'hosts':
      return scope.targetIds.includes(targetId)
    case 'group': {
      const groupId = sshHostGroupIdOf(groups, targetId)
      return groupId !== null && sshHostGroupSubtreeIds(groups, scope.groupId).has(groupId)
    }
  }
}
