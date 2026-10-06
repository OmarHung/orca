import type { NgrokAgentStatus } from '../../shared/ngrok/ngrok-types'
import { classifyNgrokLogLine, createLineSplitter } from './ngrok-agent-log'

/** The parts of the `ngrok start --none` child the agent uses. */
export type NgrokAgentProcess = {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stdin: { end(): unknown }
  kill(): boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
}

/** Starts no endpoints; Orca adds and removes them through the agent's local API. */
export const NGROK_AGENT_ARGS = ['start', '--none', '--log', 'stdout', '--log-format', 'json']

const START_TIMEOUT_MS = 20_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Orca's own ngrok agent: one process, whatever the number of endpoints it serves. */
export class NgrokManagedAgent {
  private child: NgrokAgentProcess | null = null
  private starting: Promise<string> | null = null
  private status: NgrokAgentStatus = { state: 'stopped', error: null }

  constructor(
    private readonly deps: {
      /** Rejects with a user-facing message when ngrok cannot be started. */
      spawn: () => Promise<NgrokAgentProcess>
      onStatus: (status: NgrokAgentStatus) => void
      startTimeoutMs?: number
    }
  ) {}

  getStatus(): NgrokAgentStatus {
    return this.status
  }

  /** The agent's API address, starting it first when needed. */
  ensureStarted(): Promise<string> {
    if (this.status.state === 'online') {
      return Promise.resolve(this.status.address)
    }
    this.starting ??= this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  stop(): void {
    const child = this.child
    this.child = null
    child?.kill()
    if (child || this.status.state !== 'stopped') {
      this.setStatus({ state: 'stopped', error: null })
    }
  }

  private setStatus(status: NgrokAgentStatus): void {
    this.status = status
    this.deps.onStatus(status)
  }

  private async start(): Promise<string> {
    this.setStatus({ state: 'starting' })
    let child: NgrokAgentProcess
    try {
      child = await this.deps.spawn()
    } catch (error) {
      this.setStatus({ state: 'stopped', error: messageOf(error) })
      throw error
    }
    this.child = child
    child.stdin.end()
    return this.waitUntilReady(child)
  }

  private waitUntilReady(child: NgrokAgentProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let address: string | null = null
      let sessionUp = false
      let lastError: string | null = null
      let settled = false
      const split = createLineSplitter()

      const fail = (message: string): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        // Why the check: a Stop pressed while starting already reset the status on purpose.
        if (this.child === child) {
          this.child = null
          child.kill()
          this.setStatus({ state: 'stopped', error: message })
        }
        reject(new Error(message))
      }
      const timer = setTimeout(
        () => fail(lastError ?? 'ngrok did not connect in time'),
        this.deps.startTimeoutMs ?? START_TIMEOUT_MS
      )
      const onOutput = (chunk: Buffer | string): void => {
        for (const line of split(chunk.toString())) {
          const event = classifyNgrokLogLine(line)
          if (event.kind === 'web-address') {
            address = event.address
          } else if (event.kind === 'ready') {
            sessionUp = true
          } else if (event.kind === 'failed' || event.kind === 'error') {
            lastError = event.message
            if (event.kind === 'failed') {
              fail(event.message)
            }
          }
          if (!settled && address && sessionUp) {
            settled = true
            clearTimeout(timer)
            this.setStatus({ state: 'online', address })
            resolve(address)
          }
        }
      }
      child.stdout.on('data', onOutput)
      child.stderr.on('data', onOutput)
      child.on('error', (error) => fail(error.message))
      child.on('close', () => {
        if (!settled) {
          fail(lastError ?? 'ngrok exited before it connected')
          return
        }
        if (this.child === child) {
          this.child = null
          this.setStatus({ state: 'stopped', error: lastError ?? 'ngrok stopped unexpectedly' })
        }
      })
    })
  }
}
