import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'orca.run.portTracking.v1'
const OWNER = 'run:wt\u0000dev'

async function restore(saved: unknown) {
  vi.resetModules()
  const values = new Map([[STORAGE_KEY, JSON.stringify(saved)]])
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
  })
  const { useRunPortStore } = await import('./run-port-store')
  return useRunPortStore.getState()
}

function saved(savedAt: number) {
  return {
    savedAt,
    claims: [{ owner: OWNER, worktreeId: 'wt', attemptId: 'a1', startedAt: 1_000, ports: [5173] }],
    sightings: { 'local:all': { '127.0.0.1:5173:7': 1_500 } }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('run port store restore', () => {
  it('resumes start times and sightings after a quick reload', async () => {
    const state = await restore(saved(Date.now() - 30_000))

    expect(state.claimsByOwner[OWNER]).toEqual({
      worktreeId: 'wt',
      attemptId: 'a1',
      ptyId: null,
      startedAt: 1_000,
      ports: [5173]
    })
    expect(state.sightings).toEqual({ 'local:all': { '127.0.0.1:5173:7': 1_500 } })
  })

  it('keeps only the claimed ports after a long gap', async () => {
    const state = await restore(saved(Date.now() - 10 * 60_000))

    expect(state.claimsByOwner[OWNER]).toMatchObject({ startedAt: null, ports: [5173] })
    expect(state.sightings).toEqual({})
  })

  it('starts empty from missing or malformed storage', async () => {
    const state = await restore({ savedAt: 'x', claims: [{ owner: 1 }], sightings: [] })

    expect(state.claimsByOwner).toEqual({})
    expect(state.sightings).toEqual({})
  })
})
