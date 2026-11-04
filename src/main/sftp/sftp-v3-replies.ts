import { FX_EOF, FX_OK, FXP, SftpProtocolError, type SftpPacketReader } from './sftp-v3-protocol'

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [FX_EOF]: 'End of file',
  2: 'No such file',
  3: 'Permission denied',
  4: 'Failure',
  5: 'Bad message',
  6: 'No connection',
  7: 'Connection lost',
  8: 'Operation unsupported'
}

/** A numeric `code`, as ssh2 gives, marks this as one request's failure and not a dead channel. */
export class SftpStatusError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

export function readStatus(reply: SftpPacketReader): SftpStatusError | null {
  const code = reply.u32()
  if (code === FX_OK) {
    return null
  }
  const message = reply.hasMore() ? reply.string() : ''
  return new SftpStatusError(code, message || (STATUS_MESSAGES[code] ?? `SFTP error ${code}`))
}

export function unexpectedReply(type: number): SftpProtocolError {
  return new SftpProtocolError(`The host sent an unexpected SFTP reply (type ${type}).`)
}

/** The reply a request that returns nothing gets. */
export function expectOk(type: number, reply: SftpPacketReader): void {
  if (type !== FXP.STATUS) {
    throw unexpectedReply(type)
  }
  const status = readStatus(reply)
  if (status) {
    throw status
  }
}

/** Failed requests send back a status; any other type must be the one the request is for. */
export function expectType(expected: number, type: number, reply: SftpPacketReader): void {
  if (type === expected) {
    return
  }
  if (type === FXP.STATUS) {
    throw readStatus(reply) ?? unexpectedReply(type)
  }
  throw unexpectedReply(type)
}
