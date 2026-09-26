import React from 'react'
import { Bug } from 'lucide-react'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { debugFile, isDebuggableFile } from './debug-launch'

/** "Debug 'file.py'" entry for the file tree's context menu; renders nothing for other files. */
export function DebugFileContextMenuItems({
  path,
  name,
  isDirectory
}: {
  path: string
  name: string
  isDirectory: boolean
}): React.JSX.Element | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  if (isDirectory || !activeWorktreeId || !isDebuggableFile(path)) {
    return null
  }
  return (
    <>
      <ContextMenuItem onSelect={() => void debugFile(activeWorktreeId, path)}>
        <Bug />
        {translate('debug.action.debugFile', "Debug '{{value0}}'", { value0: name })}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  )
}
