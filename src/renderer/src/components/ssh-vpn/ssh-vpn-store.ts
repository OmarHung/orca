import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import type {
  SshVpnContainerCandidate,
  SshVpnOvpnInspection,
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
  savedPasswordProfileIds: string[]
  canStorePasswords: boolean
  /** Why the settings could not be loaded (e.g. ssh-vpn.json is not valid JSON). */
  loadError: string | null
}

export const useSshVpnStore = create<SshVpnStoreState>(() => ({
  loaded: false,
  profiles: [],
  assignments: {},
  states: {},
  savedPasswordProfileIds: [],
  canStorePasswords: true,
  loadError: null
}))

let unsubscribe: (() => void) | null = null

async function refresh(): Promise<void> {
  const result = await window.api.sshVpn.snapshot()
  if (!result.ok) {
    useSshVpnStore.setState({ loaded: true, loadError: result.error.message })
    return
  }
  const snapshot = result.value
  useSshVpnStore.setState({
    loaded: true,
    loadError: null,
    profiles: snapshot.profiles,
    assignments: snapshot.assignments,
    states: Object.fromEntries(snapshot.states.map((state) => [state.profileId, state])),
    savedPasswordProfileIds: snapshot.savedPasswordProfileIds,
    canStorePasswords: snapshot.canStorePasswords
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
    draft: SshVpnProfileDraft,
    password: string | undefined
  ): Promise<{ profile: SshVpnProfile } | { error: string }> => {
    const result = await window.api.sshVpn.saveProfile({
      ...(id ? { id } : {}),
      draft,
      ...(password ? { password } : {})
    })
    return result.ok ? { profile: result.value } : { error: result.error.message }
  },
  /** Whether the .ovpn asks for a login; the error says why Orca cannot use it. */
  inspectOvpn: async (
    ovpnPath: string
  ): Promise<{ inspection: SshVpnOvpnInspection } | { error: string }> => {
    const result = await window.api.sshVpn.inspectOvpn(ovpnPath)
    return result.ok ? { inspection: result.value } : { error: result.error.message }
  },
  listContainers: async (): Promise<
    { containers: SshVpnContainerCandidate[] } | { error: string }
  > => {
    const result = await window.api.sshVpn.listContainers()
    return result.ok ? { containers: result.value } : { error: result.error.message }
  },
  deleteProfile: (profileId: string) => run(() => window.api.sshVpn.deleteProfile(profileId)),
  setAssignment: (targetId: string, profileId: string | null) =>
    run(() => window.api.sshVpn.setAssignment({ targetId, profileId })),
  connect: (profileId: string) => run(() => window.api.sshVpn.connect(profileId)),
  disconnect: (profileId: string) => run(() => window.api.sshVpn.disconnect(profileId)),
  pickOvpnFile: () => window.api.sshVpn.pickOvpnFile()
}
