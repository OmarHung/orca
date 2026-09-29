import { useAppStore } from '@/store'

export function openSshPage(): void {
  useAppStore.getState().setActiveView('ssh')
}

export function openSftpPage(): void {
  useAppStore.getState().setActiveView('sftp')
}
