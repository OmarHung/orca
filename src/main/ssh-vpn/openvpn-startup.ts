import { classifyOpenVpnLine, describeOpenVpnFailure, type OpenVpnLogTail } from './openvpn-output'
import type { OpenVpnProcess } from './ssh-vpn-manager-types'

/**
 * Resolves once OpenVPN reports the tunnel up; rejects with the cause when it fails, exits or
 * times out first. `onExitAfterReady` fires if the process ends after that.
 */
export function waitForOpenVpnReady(
  child: OpenVpnProcess,
  log: OpenVpnLogTail,
  timeoutMs: number,
  onExitAfterReady: () => void
): Promise<void> {
  child.stdin.end()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timer = setTimeout(
      () =>
        settle(
          new Error(
            `Timed out waiting for the tunnel. Last output: ${describeOpenVpnFailure(log.snapshot())}`
          )
        ),
      timeoutMs
    )
    const onOutput = (chunk: Buffer | string): void => {
      for (const line of log.push(chunk.toString())) {
        const event = classifyOpenVpnLine(line)
        if (event.kind === 'ready') {
          settle()
        } else if (event.kind === 'failed') {
          settle(new Error(describeOpenVpnFailure(log.snapshot())))
        }
      }
    }
    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    child.on('error', (error) => settle(error))
    child.on('close', () => {
      if (!settled) {
        settle(new Error(describeOpenVpnFailure(log.snapshot())))
        return
      }
      onExitAfterReady()
    })
  })
}
