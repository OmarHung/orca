import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listTerminalImagePastes,
  recordTerminalImageDrops,
  recordTerminalImagePaste,
  recordTerminalImagePastesForLeaf,
  resetTerminalImagePasteHistoryForTests,
  type TerminalImagePaste
} from './terminal-image-paste-history'

const LEAF_ID = '4a0c1a3e-5f4f-4c3a-9b7e-0d1c2b3a4f5e'
const PANE_KEY = `tab-1:${LEAF_ID}`

const mocks = vi.hoisted(() => {
  const state: { agentStatusByPaneKey: Record<string, { providerSession?: { id: string } }> } = {
    agentStatusByPaneKey: {}
  }
  return { state }
})

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))

function paste(path: string): TerminalImagePaste {
  return { path, connectionId: null, pastedAt: 1, sessionId: null }
}

beforeEach(() => {
  resetTerminalImagePasteHistoryForTests()
  mocks.state.agentStatusByPaneKey = {}
})

describe('terminal image paste history', () => {
  it('tags pastes with the pane agent session', () => {
    mocks.state.agentStatusByPaneKey = { [PANE_KEY]: { providerSession: { id: 'session-7' } } }

    recordTerminalImagePastesForLeaf({
      tabId: 'tab-1',
      leafId: LEAF_ID,
      paths: ['/tmp/orca-paste-1.png'],
      connectionId: 'ssh-1'
    })

    expect(listTerminalImagePastes(PANE_KEY)).toEqual([
      {
        path: '/tmp/orca-paste-1.png',
        connectionId: 'ssh-1',
        pastedAt: expect.any(Number),
        sessionId: 'session-7'
      }
    ])
  })

  it('ignores leaves that have no pane key identity', () => {
    recordTerminalImagePastesForLeaf({
      tabId: 'tab-1',
      leafId: 'legacy-leaf',
      paths: ['/a.png'],
      connectionId: null
    })
    expect(listTerminalImagePastes('tab-1:legacy-leaf')).toEqual([])
  })

  it('records only the image paths a drop actually wrote', () => {
    recordTerminalImageDrops(
      {
        tabId: 'tab-1',
        pane: { leafId: LEAF_ID },
        paths: ['/a.png', '/notes.md', '/b.jpg', '/c.png']
      },
      3
    )
    expect(listTerminalImagePastes(PANE_KEY).map((entry) => entry.path)).toEqual([
      '/a.png',
      '/b.jpg'
    ])
  })

  it('keeps the newest pastes per pane', () => {
    for (let index = 0; index < 40; index += 1) {
      recordTerminalImagePaste('pane', paste(`/${index}.png`))
    }
    const paths = listTerminalImagePastes('pane').map((entry) => entry.path)
    expect(paths).toHaveLength(32)
    expect(paths[0]).toBe('/8.png')
    expect(paths.at(-1)).toBe('/39.png')
  })

  it('evicts the pane pasted into least recently', () => {
    recordTerminalImagePaste('stale', paste('/stale.png'))
    for (let index = 0; index < 63; index += 1) {
      recordTerminalImagePaste(`pane-${index}`, paste('/x.png'))
    }
    recordTerminalImagePaste('stale', paste('/fresh.png'))
    recordTerminalImagePaste('newest', paste('/n.png'))

    expect(listTerminalImagePastes('stale')).toHaveLength(2)
    expect(listTerminalImagePastes('pane-0')).toEqual([])
  })
})
