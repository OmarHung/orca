import React from 'react'
import { Sparkles } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useForkUpdateChangelogStore } from './fork-update-changelog-store'

/** Help menu entry that reopens the last update's changelog; hidden until there is one. */
export function ForkUpdateChangelogMenuItem(): React.JSX.Element | null {
  const toTag = useForkUpdateChangelogStore((s) => s.changelog?.toTag ?? null)
  const openDialog = useForkUpdateChangelogStore((s) => s.openDialog)
  if (!toTag) {
    return null
  }
  return (
    <DropdownMenuItem className="whitespace-nowrap" onSelect={openDialog}>
      <Sparkles className="size-3.5" />
      {translate('forkUpdateChangelog.menuItem', "What's new in {{value0}}", { value0: toTag })}
    </DropdownMenuItem>
  )
}
