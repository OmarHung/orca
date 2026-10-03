import { useSshVpnStore } from '../../ssh-vpn/ssh-vpn-store'
import {
  NO_SSH_TUNNEL,
  NO_VPN,
  type DatabaseConnectionFormState
} from './database-connection-form-state'

/** SSH target id → VPN profile id, as the VPN store keeps them. */
type SshVpnAssignments = Readonly<Record<string, string>>

/** The VPN the form shows: the connection's own, or with an SSH tunnel that host's (picked here, else saved). */
export function shownVpnProfileId(
  form: DatabaseConnectionFormState,
  assignments: SshVpnAssignments
): string {
  if (form.sshTargetId === NO_SSH_TUNNEL) {
    return form.vpnProfileId
  }
  if (form.sshHostVpn?.targetId === form.sshTargetId) {
    return form.sshHostVpn.profileId
  }
  return assignments[form.sshTargetId] ?? NO_VPN
}

/** The VPN picked for the tunnel's SSH host when it differs from the host's saved one; else null. */
export function pendingSshHostVpn(
  form: DatabaseConnectionFormState,
  assignments: SshVpnAssignments
): { targetId: string; profileId: string | null } | null {
  const picked = form.sshHostVpn
  // Why check the target: a pick made for a host the user switched away from must not apply.
  if (form.sshTargetId === NO_SSH_TUNNEL || picked?.targetId !== form.sshTargetId) {
    return null
  }
  const profileId = picked.profileId === NO_VPN ? null : picked.profileId
  if (profileId === (assignments[form.sshTargetId] ?? null)) {
    return null
  }
  return { targetId: form.sshTargetId, profileId }
}

/** Assigns the VPN picked for the tunnel's SSH host, if it changed; returns why that failed, or null. */
export async function applySshHostVpn(form: DatabaseConnectionFormState): Promise<string | null> {
  const pending = pendingSshHostVpn(form, useSshVpnStore.getState().assignments)
  if (!pending) {
    return null
  }
  const result = await window.api.sshVpn.setAssignment(pending)
  return result.ok ? null : result.error.message
}
