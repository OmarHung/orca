import {
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  FolderUp,
  Pencil,
  Ungroup
} from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import type { SftpNameRequest } from '../sftp-page/SftpNameDialog'
import {
  canMoveSshHostGroup,
  sshHostGroupIdOf,
  sshHostGroupsInTreeOrder,
  type SshHostGroup
} from './ssh-host-groups'
import { sshHostGroupActions, useSshHostGroups } from './ssh-host-groups-store'
import { newSshHostGroupRequest, renameSshHostGroupRequest } from './ssh-host-group-name-requests'

export type AskSshHostGroupName = (request: SftpNameRequest) => void

type GroupChoice = { id: string; label: string }

function MoveToGroupSubmenu({
  choices,
  onChoose,
  extraItems
}: {
  choices: readonly GroupChoice[]
  onChoose: (groupId: string) => void
  extraItems: React.ReactNode
}): React.JSX.Element {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInput />
        {translate('sshPage.groups.moveTo', 'Move to Group')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {choices.map((choice) => (
          <ContextMenuItem key={choice.id} onSelect={() => onChoose(choice.id)}>
            <Folder />
            <span className="truncate">{choice.label}</span>
          </ContextMenuItem>
        ))}
        {choices.length > 0 && extraItems ? <ContextMenuSeparator /> : null}
        {extraItems}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/** A host's "Move to Group" submenu: another group, a new one, or out of its group. */
export function SshHostMoveToGroupSubmenu({
  targetId,
  onAskName
}: {
  targetId: string
  onAskName: AskSshHostGroupName
}): React.JSX.Element {
  const data = useSshHostGroups((state) => state.data)
  const current = sshHostGroupIdOf(data, targetId)
  const choices = sshHostGroupsInTreeOrder(data)
    .filter(({ group }) => group.id !== current)
    .map(({ group, label }) => ({ id: group.id, label }))
  return (
    <MoveToGroupSubmenu
      choices={choices}
      onChoose={(groupId) => sshHostGroupActions.moveHosts([targetId], groupId)}
      extraItems={
        <>
          <ContextMenuItem onSelect={() => onAskName(newSshHostGroupRequest(null, [targetId]))}>
            <FolderPlus />
            {translate('sshPage.groups.newGroup', 'New Group…')}
          </ContextMenuItem>
          {current !== null ? (
            <ContextMenuItem onSelect={() => sshHostGroupActions.moveHosts([targetId], null)}>
              <FolderMinus />
              {translate('sshPage.groups.removeFromGroup', 'Remove from Group')}
            </ContextMenuItem>
          ) : null}
        </>
      }
    />
  )
}

/** Right-click on a group row. */
export function SshHostGroupMenuContent({
  group,
  onAskName
}: {
  group: SshHostGroup
  onAskName: AskSshHostGroupName
}): React.JSX.Element {
  return (
    <ContextMenuContent className="min-w-48">
      <ContextMenuItem onSelect={() => onAskName(newSshHostGroupRequest(group.id))}>
        <FolderPlus />
        {translate('sshPage.groups.newSubgroup', 'New Subgroup…')}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onAskName(renameSshHostGroupRequest(group))}>
        <Pencil />
        {translate('sshPage.groups.renameGroup', 'Rename Group…')}
      </ContextMenuItem>
      {/* Why a child: content mounts only while the menu is open, so closed rows don't subscribe. */}
      <MoveGroupSubmenu group={group} />
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => sshHostGroupActions.ungroup(group.id)}>
        <Ungroup />
        {translate('sshPage.groups.ungroup', 'Ungroup')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

function MoveGroupSubmenu({ group }: { group: SshHostGroup }): React.JSX.Element | null {
  const data = useSshHostGroups((state) => state.data)
  const choices = sshHostGroupsInTreeOrder(data)
    .filter(
      (choice) =>
        choice.group.id !== group.parentId &&
        canMoveSshHostGroup(data, group.id, { kind: 'inside', groupId: choice.group.id })
    )
    .map(({ group: choice, label }) => ({ id: choice.id, label }))
  const canMoveToTop =
    group.parentId !== null &&
    canMoveSshHostGroup(data, group.id, { kind: 'inside', groupId: null })
  if (choices.length === 0 && !canMoveToTop) {
    return null
  }
  return (
    <MoveToGroupSubmenu
      choices={choices}
      onChoose={(groupId) => sshHostGroupActions.moveGroup(group.id, { kind: 'inside', groupId })}
      extraItems={
        canMoveToTop ? (
          <ContextMenuItem
            onSelect={() =>
              sshHostGroupActions.moveGroup(group.id, { kind: 'inside', groupId: null })
            }
          >
            <FolderUp />
            {translate('sshPage.groups.moveToTop', 'Move to Top Level')}
          </ContextMenuItem>
        ) : null
      }
    />
  )
}
