import { z } from 'zod'

export const DEFAULT_SSH_VPN_IDLE_MINUTES = 10
/** A day; longer than that is what 0 ("never") is for. */
export const MAX_SSH_VPN_IDLE_MINUTES = 24 * 60

export const SSH_VPN_PROFILE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/

export const sshVpnProfileIdSchema = z.string().regex(SSH_VPN_PROFILE_ID_PATTERN)

/** POSIX, drive-letter or UNC absolute path; checked here so the renderer and main agree. */
export function isAbsoluteOvpnPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

export const sshVpnProfileDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ovpnPath: z.string().trim().min(1).max(4096).refine(isAbsoluteOvpnPath),
  /** Minutes without any connection through the VPN before it stops; 0 keeps it up until quit. */
  idleMinutes: z.number().int().min(0).max(MAX_SSH_VPN_IDLE_MINUTES)
})

export type SshVpnProfileDraft = z.infer<typeof sshVpnProfileDraftSchema>

export const sshVpnProfileSchema = sshVpnProfileDraftSchema.extend({
  id: sshVpnProfileIdSchema
})

/** An OpenVPN profile that SSH hosts can be routed through. Only the .ovpn path is stored. */
export type SshVpnProfile = z.infer<typeof sshVpnProfileSchema>

export type SshVpnStatus = 'stopped' | 'starting' | 'ready' | 'stopping' | 'error'

export type SshVpnProfileState = {
  profileId: string
  status: SshVpnStatus
  /** Why the last start failed or the tunnel went down; set with `error`. */
  error?: string
  /** Most recent OpenVPN output lines, oldest first. */
  logTail: string[]
}

export type SshVpnResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

/** Everything the VPN UI shows; refetched whenever main broadcasts `sshVpn:changed`. */
export type SshVpnSnapshot = {
  profiles: SshVpnProfile[]
  /** SSH target id → VPN profile id. */
  assignments: Record<string, string>
  states: SshVpnProfileState[]
}

/** What the SSH page needs to type `ssh -o ProxyCommand=…` for a host behind a ready VPN. */
export type SshVpnTerminalRoute = {
  profileName: string
  dockerPath: string
  containerName: string
}

/** Main asks the renderer to show these commands before a VPN starts. */
export type SshVpnStartConfirmRequest = {
  requestId: string
  profileName: string
  /** The SSH host whose connection needs the VPN; null for a manual Connect. */
  hostLabel: string | null
  commands: string[]
}

export const sshVpnAssignmentSchema = z.object({
  targetId: z.string().min(1).max(200),
  profileId: sshVpnProfileIdSchema.nullable()
})

export const sshVpnSaveProfileSchema = z.object({
  id: sshVpnProfileIdSchema.optional(),
  draft: sshVpnProfileDraftSchema
})

export const sshVpnConfirmAnswerSchema = z.object({
  requestId: z.string().min(1).max(100),
  approved: z.boolean()
})
