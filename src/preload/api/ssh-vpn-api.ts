import type {
  SshVpnContainerCandidate,
  SshVpnCredentialRequest,
  SshVpnCredentials,
  SshVpnOvpnInspection,
  SshVpnProfile,
  SshVpnProfileDraft,
  SshVpnProfileState,
  SshVpnResult,
  SshVpnSnapshot,
  SshVpnStartConfirmRequest,
  SshVpnTerminalRoute
} from '../../shared/ssh-vpn-types'

export type SshVpnApi = {
  snapshot: () => Promise<SshVpnResult<SshVpnSnapshot>>
  /** Whether an .ovpn asks for a login, and whether Orca can use it at all. */
  inspectOvpn: (ovpnPath: string) => Promise<SshVpnResult<SshVpnOvpnInspection>>
  /** Running containers a profile can borrow (Orca's own VPN containers left out). */
  listContainers: () => Promise<SshVpnResult<SshVpnContainerCandidate[]>>
  saveProfile: (request: {
    id?: string
    draft: SshVpnProfileDraft
    /** Omit to keep the saved password. */
    password?: string
  }) => Promise<SshVpnResult<SshVpnProfile>>
  deleteProfile: (profileId: string) => Promise<SshVpnResult<void>>
  setAssignment: (request: {
    targetId: string
    profileId: string | null
  }) => Promise<SshVpnResult<void>>
  /** Starts the VPN after the user approves its commands in the start confirmation. */
  connect: (profileId: string) => Promise<SshVpnResult<void>>
  disconnect: (profileId: string) => Promise<SshVpnResult<void>>
  /** Null when the host has no VPN; otherwise starts it (asking first) and returns the route. */
  prepareTerminal: (targetId: string) => Promise<SshVpnResult<SshVpnTerminalRoute | null>>
  pickOvpnFile: () => Promise<string | null>
  answerStart: (answer: { requestId: string; approved: boolean }) => Promise<void>
  /** Null cancels the start. */
  answerCredentials: (answer: {
    requestId: string
    credentials: SshVpnCredentials | null
  }) => Promise<void>
  onState: (callback: (state: SshVpnProfileState) => void) => () => void
  /** Profiles or assignments changed; refetch the snapshot. */
  onChanged: (callback: () => void) => () => void
  onConfirmStart: (callback: (request: SshVpnStartConfirmRequest) => void) => () => void
  onCredentialRequest: (callback: (request: SshVpnCredentialRequest) => void) => () => void
}
