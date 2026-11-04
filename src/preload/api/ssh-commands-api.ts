import type {
  SshCommand,
  SshCommandResult,
  SshCommandSaveRequest
} from '../../shared/ssh-command-types'

export type SshCommandsApi = {
  list: () => Promise<SshCommandResult<SshCommand[]>>
  save: (request: SshCommandSaveRequest) => Promise<SshCommandResult<SshCommand>>
  delete: (id: string) => Promise<SshCommandResult<null>>
}
