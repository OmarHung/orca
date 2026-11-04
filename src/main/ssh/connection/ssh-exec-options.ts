export type SshExecOptions = {
  wrapCommand?: boolean
  /** Compression is execCommand-only: it can retry plain when hosts lack base64/gzip; direct exec cannot. */
  compressCommand?: boolean
  signal?: AbortSignal
  /** System ssh only: the command names a subsystem (`ssh -s`), with no shell or wrapping. */
  subsystem?: boolean
  /** System ssh only: keeps a stalled long-lived channel from hanging when no shared master watches it. */
  keepAlive?: boolean
}

export function createSshOperationAbortError(): Error & { name: string } {
  const error = new Error('SSH operation was cancelled')
  error.name = 'AbortError'
  return error
}
