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

/** Docker's own rule for container names. */
export const DOCKER_CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/

const profileNameSchema = z.string().trim().min(1).max(120)

const ovpnProfileDraftSchema = z.object({
  // Why optional: profiles saved before borrowed containers existed have no kind.
  kind: z.literal('ovpn').optional(),
  name: profileNameSchema,
  ovpnPath: z.string().trim().min(1).max(4096).refine(isAbsoluteOvpnPath),
  /** Minutes without any connection through the VPN before it stops; 0 keeps it up until quit. */
  idleMinutes: z.number().int().min(0).max(MAX_SSH_VPN_IDLE_MINUTES),
  /** For profiles that ask for a username and password (`auth-user-pass`); unset otherwise. */
  username: z.string().trim().min(1).max(200).optional(),
  passwordStorage: z.enum(SSH_VPN_PASSWORD_STORAGE_MODES).optional()
})

/** A VPN container someone else runs (e.g. openvpn-socks); Orca only `docker exec`s into it. */
const containerProfileDraftSchema = z.object({
  kind: z.literal('container'),
  name: profileNameSchema,
  containerName: z.string().trim().regex(DOCKER_CONTAINER_NAME_PATTERN)
})

export const sshVpnProfileDraftSchema = z.union([
  containerProfileDraftSchema,
  ovpnProfileDraftSchema
])

export type SshVpnProfileDraft = z.infer<typeof sshVpnProfileDraftSchema>
export type SshVpnOvpnProfileDraft = Exclude<SshVpnProfileDraft, { kind: 'container' }>

const sshVpnProfileIdField = { id: sshVpnProfileIdSchema }

export const sshVpnProfileSchema = z.union([
  containerProfileDraftSchema.extend(sshVpnProfileIdField),
  ovpnProfileDraftSchema.extend(sshVpnProfileIdField)
])

/** A VPN that SSH hosts can be routed through: an .ovpn Orca runs, or a container it borrows. */
export type SshVpnProfile = z.infer<typeof sshVpnProfileSchema>
export type SshVpnOvpnProfile = Exclude<SshVpnProfile, { kind: 'container' }>
export type SshVpnContainerProfile = Extract<SshVpnProfile, { kind: 'container' }>

/** What a profile connects through; a change means the running VPN no longer matches it. */
export function sshVpnProfileSource(profile: SshVpnProfileDraft): string {
  return profile.kind === 'container'
    ? `container:${profile.containerName}`
    : `ovpn:${profile.ovpnPath}`
}

/** A running container the profile form offers to borrow. */
export type SshVpnContainerCandidate = { name: string; image: string; status: string }

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
  profileId: string
  profileName: string
  /** The SSH host whose connection needs the VPN; null for a manual Connect. */
  hostLabel: string | null
  /** An SSH host's connection, so the user may pick another VPN for the host instead. */
  switchable: boolean
  commands: string[]
}

/** What using a VPN would take right now, for the start confirmation's VPN picker. */
export type SshVpnStartPreview =
  | { kind: 'start'; commands: string[] }
  | { kind: 'ready' }
  /** Started outside Orca; Orca only checks the container and connects through it. */
  | { kind: 'borrowed'; containerName: string }

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

// Why bounded: the commands only come back from the confirmation, which lists a few dozen at most.
const approvedCommandsSchema = z.array(z.string().max(100_000)).max(1000)

export const sshVpnConfirmAnswerSchema = z.object({
  requestId: z.string().min(1).max(100),
  approved: z.boolean(),
  /** Approved for another VPN picked in the confirmation, after seeing these commands for it. */
  switchTo: z
    .object({ profileId: sshVpnProfileIdSchema, commands: approvedCommandsSchema })
    .optional()
})

export type SshVpnStartAnswer = Omit<z.infer<typeof sshVpnConfirmAnswerSchema>, 'requestId'>
