import { describe, expect, it } from 'vitest'
import { createDapMessageReader, encodeDapMessage } from './dap-framing'

function frame(body: string): Buffer {
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`, 'utf8')
}

describe('encodeDapMessage', () => {
  it('prefixes the JSON body with its UTF-8 byte length', () => {
    const encoded = encodeDapMessage({ seq: 1, type: 'request', command: 'x', arguments: '中' })

    const text = encoded.toString('utf8')
    const body = JSON.stringify({ seq: 1, type: 'request', command: 'x', arguments: '中' })
    expect(text).toBe(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
  })
})

describe('createDapMessageReader', () => {
  it('parses a message delivered in one chunk', () => {
    const messages: unknown[] = []
    const reader = createDapMessageReader((message) => messages.push(message))

    reader.push(frame('{"seq":1,"type":"event","event":"initialized"}'))

    expect(messages).toEqual([{ seq: 1, type: 'event', event: 'initialized' }])
  })

  it('reassembles a message split across chunks, including inside a multi-byte character', () => {
    const messages: unknown[] = []
    const reader = createDapMessageReader((message) => messages.push(message))
    const bytes = frame('{"seq":2,"type":"event","event":"output","body":{"output":"中文"}}')

    for (let index = 0; index < bytes.length; index += 3) {
      reader.push(bytes.subarray(index, index + 3))
    }

    expect(messages).toEqual([{ seq: 2, type: 'event', event: 'output', body: { output: '中文' } }])
  })

  it('parses several messages delivered in one chunk', () => {
    const messages: unknown[] = []
    const reader = createDapMessageReader((message) => messages.push(message))

    reader.push(
      Buffer.concat([
        frame('{"seq":1,"type":"event","event":"a"}'),
        frame('{"seq":2,"type":"event","event":"b"}')
      ])
    )

    expect(messages).toHaveLength(2)
  })

  it('reports malformed frames without stopping later messages', () => {
    const messages: unknown[] = []
    const errors: Error[] = []
    const reader = createDapMessageReader(
      (message) => messages.push(message),
      (error) => errors.push(error)
    )

    reader.push(frame('not json'))
    reader.push(frame('{"seq":3,"type":"event","event":"ok"}'))

    expect(errors).toHaveLength(1)
    expect(messages).toEqual([{ seq: 3, type: 'event', event: 'ok' }])
  })

  it('rejects a header without Content-Length', () => {
    const errors: Error[] = []
    const reader = createDapMessageReader(
      () => {},
      (error) => errors.push(error)
    )

    reader.push(Buffer.from('X-Other: 1\r\n\r\n{}', 'utf8'))

    expect(errors[0]?.message).toMatch(/Content-Length/)
  })
})
