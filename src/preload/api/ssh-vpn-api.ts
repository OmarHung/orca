import type {
  SshVpnProfile,
  SshVpnProfileDraft,
  SshVpnProfileState,
  SshVpnResult,
  SshVpnSnapshot,
  SshVpnStartConfirmRequest,
  SshVpnTerminalRoute
} from '../../shared/ssh-vpn-types'

export type SshVpnApi = {
  snapshot: () => Promise<SshVpnSnapshot>
  saveProfile: (request: {
    id?: string
    draft: SshVpnProfileDraft
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
  onState: (callback: (state: SshVpnProfileState) => void) => () => void
  /** Profiles or assignments changed; refetch the snapshot. */
  onChanged: (callback: () => void) => () => void
  onConfirmStart: (callback: (request: SshVpnStartConfirmRequest) => void) => () => void
}
