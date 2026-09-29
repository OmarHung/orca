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

export const SSH_VPN_PASSWORD_STORAGE_MODES = ['forever', 'session', 'never'] as const
/** Same meanings as the database page: keychain, until Orca quits, or ask every time. */
export type SshVpnPasswordStorage = (typeof SSH_VPN_PASSWORD_STORAGE_MODES)[number]

export const sshVpnProfileDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ovpnPath: z.string().trim().min(1).max(4096).refine(isAbsoluteOvpnPath),
  /** Minutes without any connection through the VPN before it stops; 0 keeps it up until quit. */
  idleMinutes: z.number().int().min(0).max(MAX_SSH_VPN_IDLE_MINUTES),
  /** For profiles that ask for a username and password (`auth-user-pass`); unset otherwise. */
  username: z.string().trim().min(1).max(200).optional(),
  passwordStorage: z.enum(SSH_VPN_PASSWORD_STORAGE_MODES).optional()
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

export type SshVpnResult<T> =
  | { ok: true; value: T }
  /** `declined`: the user said no to starting the VPN, which is not an error to report. */
  | { ok: false; error: { message: string; declined?: boolean } }

/** Everything the VPN UI shows; refetched whenever main broadcasts `sshVpn:changed`. */
export type SshVpnSnapshot = {
  profiles: SshVpnProfile[]
  /** SSH target id → VPN profile id. */
  assignments: Record<string, string>
  states: SshVpnProfileState[]
  /** Profiles whose password is kept (keychain or until quit), so they connect without asking. */
  savedPasswordProfileIds: string[]
  /** False when the OS has no keychain, so 'forever' is not offered. */
  canStorePasswords: boolean
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
  draft: sshVpnProfileDraftSchema,
  /** Omitted keeps the saved password. */
  password: z.string().min(1).max(1000).optional()
})

/** What the profile form needs to know about an .ovpn before it is saved. */
export type SshVpnOvpnInspection = { needsCredentials: boolean }

export type SshVpnCredentials = { username: string; password: string }

/** Main asks the renderer for a VPN login when none is saved (or the last one was rejected). */
export type SshVpnCredentialRequest = {
  requestId: string
  profileName: string
  username: string
  hostLabel: string | null
  /** Why it asks again, e.g. the server rejected the last password. */
  error: string | null
}

export const sshVpnCredentialAnswerSchema = z.object({
  requestId: z.string().min(1).max(100),
  credentials: z
    .object({
      username: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(1000)
    })
    .nullable()
})

export const sshVpnConfirmAnswerSchema = z.object({
  requestId: z.string().min(1).max(100),
  approved: z.boolean()
})
