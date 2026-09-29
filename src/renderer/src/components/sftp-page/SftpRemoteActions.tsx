import { Fragment } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { PaneIconButton } from './SftpFilePane'

export type SftpRemoteAction = {
  id: 'download' | 'newFolder' | 'rename' | 'move' | 'delete'
  label: string
  Icon: LucideIcon
  isDisabled: boolean
  run: () => void
}

/** The remote pane's toolbar: Download with its label, the rest as icons. */
export function SftpRemoteToolbar({
  actions
}: {
  actions: readonly SftpRemoteAction[]
}): React.JSX.Element {
  return (
    <>
      {actions.map(({ id, label, Icon, isDisabled, run }) =>
        id === 'download' ? (
          <Button key={id} variant="outline" size="xs" disabled={isDisabled} onClick={run}>
            <Icon className="size-3" />
            {label}
          </Button>
        ) : (
          <PaneIconButton key={id} label={label} disabled={isDisabled} onClick={run}>
            <Icon className="size-3.5" />
          </PaneIconButton>
        )
      )}
    </>
  )
}

/** The same actions as right-click menu items, with Delete set apart. */
export function SftpRemoteMenuItems({
  actions
}: {
  actions: readonly SftpRemoteAction[]
}): React.JSX.Element {
  return (
    <>
      {actions.map(({ id, label, Icon, isDisabled, run }) => (
        <Fragment key={id}>
          {id === 'delete' ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            variant={id === 'delete' ? 'destructive' : 'default'}
            disabled={isDisabled}
            onSelect={run}
          >
            <Icon />
            {label}
          </ContextMenuItem>
        </Fragment>
      ))}
    </>
  )
}
