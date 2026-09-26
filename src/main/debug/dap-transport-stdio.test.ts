import { describe, expect, it, vi } from 'vitest'
import { startStdioDapTransport } from './dap-transport-stdio'

const ECHO_SCRIPT = "process.stdin.on('data', (d) => process.stdout.write(d))"

describe('startStdioDapTransport', () => {
  it('pipes bytes to the child and back', async () => {
    const transport = startStdioDapTransport({
      program: process.execPath,
      args: ['-e', ECHO_SCRIPT],
      cwd: process.cwd(),
      env: process.env
    })
    const received: Buffer[] = []
    transport.onData((chunk) => received.push(chunk))

    transport.write(Buffer.from('ping'))

    await vi.waitFor(() => expect(Buffer.concat(received).toString()).toBe('ping'))
    transport.close()
  })

  it('reports close once the child is stopped', async () => {
    const transport = startStdioDapTransport({
      program: process.execPath,
      args: ['-e', ECHO_SCRIPT],
      cwd: process.cwd(),
      env: process.env
    })
    const onClose = vi.fn()
    transport.onClose(onClose)

    transport.close()

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('reports close with an error when the program cannot start', async () => {
    const transport = startStdioDapTransport({
      program: '/nonexistent/debug-adapter',
      args: [],
      cwd: process.cwd(),
      env: process.env
    })
    const onClose = vi.fn()
    transport.onClose(onClose)

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onClose.mock.calls[0][0].error).toBeInstanceOf(Error)
  })

  it('forwards stderr text', async () => {
    const onStderr = vi.fn()
    startStdioDapTransport({
      program: process.execPath,
      args: ['-e', "process.stderr.write('boom')"],
      cwd: process.cwd(),
      env: process.env,
      onStderr
    })

    await vi.waitFor(() => expect(onStderr).toHaveBeenCalledWith('boom'))
  })
})
