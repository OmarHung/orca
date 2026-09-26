export type DapTransportClose = {
  code: number | null
  signal: NodeJS.Signals | null
  error: Error | null
}

/** A byte pipe to one debug adapter; stdio and TCP adapters both fit this shape. */
export type DapTransport = {
  write: (data: Buffer) => void
  onData: (listener: (chunk: Buffer) => void) => void
  onClose: (listener: (reason: DapTransportClose) => void) => void
  close: () => void
}
