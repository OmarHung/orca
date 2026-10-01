import { translate } from '@/i18n/i18n'
import type { SftpNameRequest } from '../sftp-page/SftpNameDialog'
import {
  findSshHostGroup,
  isSshHostGroupNameTaken,
  normalizeSshHostGroupName,
  SSH_HOST_GROUP_NAME_MAX_LENGTH,
  type SshHostGroup
} from './ssh-host-groups'
import { sshHostGroupActions, useSshHostGroups } from './ssh-host-groups-store'

function nameProblem(value: string, parentId: string | null, exceptId?: string): string | null {
  const name = normalizeSshHostGroupName(value)
  if (name === null) {
    return null
  }
  if (name.length > SSH_HOST_GROUP_NAME_MAX_LENGTH) {
    return translate('sshPage.groups.nameTooLong', 'Use {{max}} characters or fewer.', {
      max: SSH_HOST_GROUP_NAME_MAX_LENGTH
    })
  }
  return isSshHostGroupNameTaken(useSshHostGroups.getState().data, name, parentId, exceptId)
    ? translate('sshPage.groups.nameTaken', 'A group with this name is already here.')
    : null
}

function nameFields(
  parentId: string | null,
  exceptId?: string
): Pick<SftpNameRequest, 'inputLabel' | 'isValid' | 'invalidReason'> {
  return {
    inputLabel: translate('sshPage.groups.name', 'Group name'),
    isValid: (value) => normalizeSshHostGroupName(value) !== null,
    invalidReason: (value) => nameProblem(value, parentId, exceptId)
  }
}

/** Names a new group under `parentId` (null: top level) and files `targetIds` in it. */
export function newSshHostGroupRequest(
  parentId: string | null,
  targetIds: readonly string[] = []
): SftpNameRequest {
  const parent =
    parentId === null ? undefined : findSshHostGroup(useSshHostGroups.getState().data, parentId)
  return {
    title: parent
      ? translate('sshPage.groups.newSubgroupTitle', 'New Subgroup in “{{name}}”', {
          name: parent.name
        })
      : translate('sshPage.groups.newTitle', 'New Group'),
    confirmLabel: translate('sshPage.groups.create', 'Create'),
    initialName: '',
    ...nameFields(parentId),
    onSubmit: (name) => sshHostGroupActions.create(name, parentId, targetIds)
  }
}

export function renameSshHostGroupRequest(group: SshHostGroup): SftpNameRequest {
  return {
    title: translate('sshPage.groups.renameTitle', 'Rename Group'),
    confirmLabel: translate('sshPage.groups.rename', 'Rename'),
    initialName: group.name,
    ...nameFields(group.parentId, group.id),
    onSubmit: (name) => sshHostGroupActions.rename(group.id, name)
  }
}
