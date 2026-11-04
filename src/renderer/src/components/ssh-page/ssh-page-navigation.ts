import { useAppStore } from '@/store'

export function openSshPage(): void {
  useAppStore.getState().setActiveView('ssh')
}
