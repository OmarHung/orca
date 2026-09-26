// Debug Adapter Protocol wire format: `Content-Length: N\r\n\r\n` followed by N bytes of JSON.
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii')
const CONTENT_LENGTH_PATTERN = /^Content-Length:\s*(\d+)\s*$/im
// Why: a corrupt length would otherwise make the reader buffer unbounded adapter output.
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

export type DapMessageReader = {
  push: (chunk: Buffer) => void
}

export function encodeDapMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

export function createDapMessageReader(
  onMessage: (message: unknown) => void,
  onError: (error: Error) => void = () => {}
): DapMessageReader {
  let buffer: Buffer = Buffer.alloc(0)
  let bodyLength: number | null = null

  const readHeader = (): boolean => {
    const separatorIndex = buffer.indexOf(HEADER_SEPARATOR)
    if (separatorIndex === -1) {
      return false
    }
    const header = buffer.subarray(0, separatorIndex).toString('ascii')
    buffer = buffer.subarray(separatorIndex + HEADER_SEPARATOR.length)
    const match = CONTENT_LENGTH_PATTERN.exec(header)
    const length = match ? Number(match[1]) : Number.NaN
    if (!Number.isSafeInteger(length) || length > MAX_MESSAGE_BYTES) {
      onError(new Error(`Invalid DAP header, missing a usable Content-Length: ${header}`))
      return true
    }
    bodyLength = length
    return true
  }

  const readBody = (length: number): boolean => {
    if (buffer.length < length) {
      return false
    }
    const body = buffer.subarray(0, length).toString('utf8')
    buffer = buffer.subarray(length)
    bodyLength = null
    try {
      onMessage(JSON.parse(body))
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)))
    }
    return true
  }

  return {
    push(chunk) {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
      let progressed = true
      while (progressed) {
        progressed = bodyLength === null ? readHeader() : readBody(bodyLength)
      }
    }
  }
}
