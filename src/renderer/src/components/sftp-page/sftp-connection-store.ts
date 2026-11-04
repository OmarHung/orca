import { create } from 'zustand'
import type { SftpConnectionState } from '../../../../shared/sftp-types'

type SftpConnectionStoreState = {
  /** Absent until a host's connection first reports; one connection serves all its tabs. */
  byTarget: Readonly<Record<string, SftpConnectionState>>
  apply: (state: SftpConnectionState) => void
  /** Fills in what main already knew; an event that arrived first is newer, so it stays. */
  applySnapshot: (states: readonly SftpConnectionState[]) => void
}

export const useSftpConnectionStore = create<SftpConnectionStoreState>((set, get) => ({
  byTarget: {},
  apply: (state) => set({ byTarget: { ...get().byTarget, [state.targetId]: state } }),
  applySnapshot: (states) => {
    const known = Object.fromEntries(states.map((state) => [state.targetId, state]))
    set({ byTarget: { ...known, ...get().byTarget } })
  }
}))
