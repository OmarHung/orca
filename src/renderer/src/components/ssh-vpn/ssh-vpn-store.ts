import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import type {
  SshVpnProfile,
  SshVpnProfileDraft,
  SshVpnProfileState,
  SshVpnResult
} from '../../../../shared/ssh-vpn-types'

type SshVpnStoreState = {
  loaded: boolean
  profiles: SshVpnProfile[]
  /** SSH target id → VPN profile id. */
  assignments: Record<string, string>
  states: Record<string, SshVpnProfileState>
}

export const useSshVpnStore = create<SshVpnStoreState>(() => ({
  loaded: false,
  profiles: [],
  assignments: {},
  states: {}
}))

let unsubscribe: (() => void) | null = null

async function refresh(): Promise<void> {
  const snapshot = await window.api.sshVpn.snapshot()
  useSshVpnStore.setState({
    loaded: true,
    profiles: snapshot.profiles,
    assignments: snapshot.assignments,
    states: Object.fromEntries(snapshot.states.map((state) => [state.profileId, state]))
  })
}

/** Loads VPN profiles once and keeps them live; safe to call from every component that shows them. */
export function useSshVpnSync(): void {
  useEffect(() => {
    // Why: the web client and unit tests have no sshVpn bridge; the UI then shows no VPNs.
    if (unsubscribe || !window.api?.sshVpn) {
      return
    }
    const offState = window.api.sshVpn.onState((state) =>
      useSshVpnStore.setState((current) => ({
        states: { ...current.states, [state.profileId]: state }
      }))
    )
    const offChanged = window.api.sshVpn.onChanged(() => void refresh())
    unsubscribe = () => {
      offState()
      offChanged()
    }
    void refresh()
  }, [])
}

export function stateOfProfile(
  states: Record<string, SshVpnProfileState>,
  profileId: string
): SshVpnProfileState {
  return states[profileId] ?? { profileId, status: 'stopped', logTail: [] }
}

/** Runs a VPN IPC call; failures become a toast and `null`, so callers only handle success. */
async function run<T>(call: () => Promise<SshVpnResult<T>>): Promise<T | null> {
  try {
    const result = await call()
    if (result.ok) {
      return result.value
    }
    if (!result.error.declined) {
      toast.error(result.error.message)
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
  }
  return null
}

export const sshVpnActions = {
  /** Returns the saved profile, or the reason it could not be saved (shown inline by the form). */
  saveProfile: async (
    id: string | undefined,
    draft: SshVpnProfileDraft
  ): Promise<{ profile: SshVpnProfile } | { error: string }> => {
    const result = await window.api.sshVpn.saveProfile({ ...(id ? { id } : {}), draft })
    return result.ok ? { profile: result.value } : { error: result.error.message }
  },
  deleteProfile: (profileId: string) => run(() => window.api.sshVpn.deleteProfile(profileId)),
  setAssignment: (targetId: string, profileId: string | null) =>
    run(() => window.api.sshVpn.setAssignment({ targetId, profileId })),
  connect: (profileId: string) => run(() => window.api.sshVpn.connect(profileId)),
  disconnect: (profileId: string) => run(() => window.api.sshVpn.disconnect(profileId)),
  pickOvpnFile: () => window.api.sshVpn.pickOvpnFile()
}
