import { FolderSync, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { openSftpPage, openSshPage } from './ssh-page-navigation'

type NavEntryProps = {
  icon: LucideIcon
  label: string
  isActive: boolean
  onClick: () => void
}

// Why: mirrors the Automations entry in SidebarNav so the fork's entries read as native.
function NavEntry({ icon: Icon, label, isActive, onClick }: NavEntryProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
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

export function SshSidebarNavEntries(): React.JSX.Element {
  const activeView = useAppStore((s) => s.activeView)
  return (
    <>
      <NavEntry
        icon={SquareTerminal}
        label={translate('sshPage.nav.ssh', 'SSH')}
        isActive={activeView === 'ssh'}
        onClick={openSshPage}
      />
      <NavEntry
        icon={FolderSync}
        label={translate('sftpPage.nav.sftp', 'SFTP')}
        isActive={activeView === 'sftp'}
        onClick={openSftpPage}
      />
    </>
  )
}
