import { describe, expect, it } from 'vitest'
import { configuredForShare } from './ngrok-reserved-url'

const reserved = {
  name: '5016',
  url: 'https://sample.ngrok-free.dev',
  upstreamPort: 5016,
  online: false
}

describe('configuredForShare', () => {
  it('gives a port its own ngrok.yml endpoint, and the first other port the free reserved URL', () => {
    expect(configuredForShare([reserved], 5016)).toEqual({ entry: reserved, borrowed: false })
    expect(configuredForShare([reserved], 7182)).toEqual({ entry: reserved, borrowed: true })
  })

  it('leaves later shares a random URL while the reserved one is in use', () => {
    const inUse = { ...reserved, online: true }
    expect(configuredForShare([inUse], 7182)).toBeNull()
    expect(configuredForShare([inUse], 5016)).toBeNull()
  })

  it('never lends a definition without a reserved URL', () => {
    const random = { name: 'web', url: null, upstreamPort: 3000, online: false }
    expect(configuredForShare([random], 3000)).toEqual({ entry: random, borrowed: false })
    expect(configuredForShare([random], 8080)).toBeNull()
  })
})
