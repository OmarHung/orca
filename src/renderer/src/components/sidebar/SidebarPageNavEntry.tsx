import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type SidebarPageNavEntryProps = {
  icon: LucideIcon
  label: string
  isActive: boolean
  onClick: () => void
  testId?: string
}

// Why: mirrors the Automations entry in SidebarNav so the fork's entries read as native.
export function SidebarPageNavEntry({
  icon: Icon,
  label,
  isActive,
  onClick,
  testId
}: SidebarPageNavEntryProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        isActive
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', !isActive && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={isActive ? 2.25 : 1.75}
      />
      <span className="flex-1">{label}</span>
    </button>
  )
}
