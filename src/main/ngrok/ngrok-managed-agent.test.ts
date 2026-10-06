import { describe, expect, it } from 'vitest'
import type { NgrokAgentStatus } from '../../shared/ngrok/ngrok-types'
import { FakeAgentProcess } from './fake-ngrok-agent-test-fixtures'
import { NgrokManagedAgent } from './ngrok-managed-agent'

function setup(options: { startTimeoutMs?: number } = {}): {
  agent: NgrokManagedAgent
  children: FakeAgentProcess[]
  statuses: NgrokAgentStatus[]
} {
  const children: FakeAgentProcess[] = []
  const statuses: NgrokAgentStatus[] = []
  const agent = new NgrokManagedAgent({
    spawn: async () => {
      const child = new FakeAgentProcess()
      children.push(child)
      return child
    },
    onStatus: (status) => statuses.push(status),
    startTimeoutMs: options.startTimeoutMs
  })
  return { agent, children, statuses }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('NgrokManagedAgent', () => {
  it('is online once it has an API address and a session, and starts only once', async () => {
    const { agent, children } = setup()
    const first = agent.ensureStarted()
    const second = agent.ensureStarted()
    await flush()
    children[0].comeOnline('127.0.0.1:4041')
    await expect(first).resolves.toBe('127.0.0.1:4041')
    await expect(second).resolves.toBe('127.0.0.1:4041')
    expect(children).toHaveLength(1)
    expect(agent.getStatus()).toEqual({ state: 'online', address: '127.0.0.1:4041' })
    await expect(agent.ensureStarted()).resolves.toBe('127.0.0.1:4041')
  })

  it('reports why ngrok failed to start', async () => {
    const { agent, children } = setup()
    const started = agent.ensureStarted()
    await flush()
    children[0].log({
      lvl: 'crit',
      msg: 'command failed',
      err: 'authentication failed\nERR_NGROK_4018'
    })
    await expect(started).rejects.toThrow('authentication failed (ERR_NGROK_4018)')
    expect(children[0].killed).toBe(true)
    expect(agent.getStatus()).toEqual({
      state: 'stopped',
      error: 'authentication failed (ERR_NGROK_4018)'
    })
  })

  it('gives the last error when it never connects', async () => {
    const { agent, children } = setup({ startTimeoutMs: 20 })
    const started = agent.ensureStarted()
    await flush()
    children[0].log({ lvl: 'eror', msg: 'failed to reconnect session', err: 'dial tcp: no route' })
    await expect(started).rejects.toThrow('dial tcp: no route')
  })

  it('marks an agent that exits later as stopped with its error', async () => {
    const { agent, children } = setup()
    const started = agent.ensureStarted()
    await flush()
    children[0].comeOnline('127.0.0.1:4040')
    await started
    children[0].emit('close')
    expect(agent.getStatus()).toEqual({ state: 'stopped', error: 'ngrok stopped unexpectedly' })
  })

  it('stops cleanly, also while starting', async () => {
    const { agent, children, statuses } = setup()
    const started = agent.ensureStarted()
    await flush()
    agent.stop()
    await expect(started).rejects.toThrow()
    expect(children[0].killed).toBe(true)
    expect(agent.getStatus()).toEqual({ state: 'stopped', error: null })
    expect(statuses.at(-1)).toEqual({ state: 'stopped', error: null })
  })
})
