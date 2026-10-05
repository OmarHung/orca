import { useAppStore } from '@/store'

export function openMondayPage(): void {
  useAppStore.getState().setActiveView('monday')
}
