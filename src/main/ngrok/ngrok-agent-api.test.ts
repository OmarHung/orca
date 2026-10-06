import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeNgrokAgent } from './fake-ngrok-agent-test-fixtures'
import {
  createNgrokEndpoint,
  deleteNgrokEndpoint,
  isLoopbackAgentAddress,
  listNgrokEndpoints
} from './ngrok-agent-api'

let agent: FakeNgrokAgent

beforeEach(async () => {
  agent = new FakeNgrokAgent()
  await agent.start()
})

afterEach(async () => {
  await agent.stop()
})

describe('ngrok agent API', () => {
  it('creates, lists and deletes an endpoint', async () => {
    const created = await createNgrokEndpoint(agent.address, {
      name: 'orca-5173',
      upstream: 'http://localhost:5173'
    })
    expect(created).toEqual({
      name: 'orca-5173',
      publicUrl: 'https://orca-5173.ngrok.test',
      upstream: 'http://localhost:5173'
    })
    expect(await listNgrokEndpoints(agent.address)).toEqual([created])

    await deleteNgrokEndpoint(agent.address, 'orca-5173')
    expect(await listNgrokEndpoints(agent.address)).toEqual([])
  })

  it('counts an endpoint that is already gone as stopped', async () => {
    await expect(deleteNgrokEndpoint(agent.address, 'missing')).resolves.toBeUndefined()
  })

  it('falls back to the tunnels API of an older agent', async () => {
    agent.endpoints.set('web', {
      name: 'web',
      url: 'https://web.ngrok.test',
      upstream: 'http://localhost:3000'
    })
    agent.legacyOnly = true
    expect(await listNgrokEndpoints(agent.address)).toEqual([
      { name: 'web', publicUrl: 'https://web.ngrok.test', upstream: 'http://localhost:3000' }
    ])
    await deleteNgrokEndpoint(agent.address, 'web')
    expect(agent.endpoints.size).toBe(0)
  })

  it("surfaces ngrok's own reason when an endpoint cannot start", async () => {
    agent.createError =
      "failed to start tunnel: The endpoint 'https://x.ngrok-free.dev' is already online. Either\n1. stop your existing endpoint first\r\n\r\nERR_NGROK_334\r\n"
    await expect(
      createNgrokEndpoint(agent.address, { name: 'orca-1', upstream: 'http://localhost:1' })
    ).rejects.toThrow(
      "failed to start tunnel: The endpoint 'https://x.ngrok-free.dev' is already online. Either (ERR_NGROK_334)"
    )
  })

  it('refuses addresses off this machine', async () => {
    expect(isLoopbackAgentAddress('127.0.0.1:4040')).toBe(true)
    expect(isLoopbackAgentAddress('[::1]:4040')).toBe(true)
    expect(isLoopbackAgentAddress('192.168.1.5:4040')).toBe(false)
    expect(isLoopbackAgentAddress('127.0.0.1:4040/../x')).toBe(false)
    await expect(listNgrokEndpoints('example.com:80')).rejects.toThrow('Not a local ngrok agent')
  })
})
