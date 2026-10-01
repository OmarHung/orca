import {
  canMoveSshHostGroup,
  findSshHostGroup,
  type SshHostGroupPlacement,
  type SshHostGroupsData
} from './ssh-host-groups'
import { sshHostGroupRowKey, type SshHostTreeRow } from './ssh-host-tree'

export type SshHostDragItem =
  | { kind: 'host'; targetId: string; groupId: string | null }
  | { kind: 'group'; groupId: string }

export type SshHostDrop = {
  placement: SshHostGroupPlacement
  /** The row marked as where the drop lands; null marks the whole list (top level). */
  indicatorKey: string | null
  indicator: 'inside' | 'before' | 'after'
}

/** The outer quarters of a group row reorder a dragged group; the middle nests it. */
const REORDER_EDGE = 0.25

function insideDrop(groupId: string | null, rootKey: string | null): SshHostDrop {
  return {
    placement: { kind: 'inside', groupId },
    indicatorKey: groupId === null ? rootKey : sshHostGroupRowKey(groupId),
    indicator: 'inside'
  }
}

function groupDropOnRow(
  row: Extract<SshHostTreeRow, { kind: 'group' }>,
  offsetRatio: number
): SshHostDrop {
  if (offsetRatio < REORDER_EDGE || offsetRatio > 1 - REORDER_EDGE) {
    const kind = offsetRatio < REORDER_EDGE ? 'before' : 'after'
    return {
      placement: { kind, groupId: row.group.id },
      indicatorKey: row.key,
      indicator: kind
    }
  }
  return insideDrop(row.group.id, null)
}

/**
 * Where `item` would land if dropped over `row` (null: the list outside any row), or null when
 * that drop changes nothing or isn't allowed. `offsetRatio` is the pointer's height in the row.
 */
export function resolveSshHostDrop(args: {
  data: SshHostGroupsData
  item: SshHostDragItem
  row: SshHostTreeRow | null
  offsetRatio: number
  /** The row standing for the top level (the ungrouped heading), if shown. */
  rootKey: string | null
}): SshHostDrop | null {
  const { data, item, row, offsetRatio, rootKey } = args
  const targetGroupId =
    row?.kind === 'group' ? row.group.id : row?.kind === 'host' ? row.groupId : null

  if (item.kind === 'host') {
    return targetGroupId === item.groupId ? null : insideDrop(targetGroupId, rootKey)
  }
  const drop =
    row?.kind === 'group' ? groupDropOnRow(row, offsetRatio) : insideDrop(targetGroupId, rootKey)
  if (!canMoveSshHostGroup(data, item.groupId, drop.placement)) {
    return null
  }
  // Why: nesting a group in its own parent again would only shuffle it to the end.
  const isSameParent =
    drop.placement.kind === 'inside' &&
    findSshHostGroup(data, item.groupId)?.parentId === drop.placement.groupId
  return isSameParent ? null : drop
}
