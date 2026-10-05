// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import type { ILink } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalImagePreviewStore } from '@/store/terminal-image-preview'
import {
  createClaudeImageMarkerLinkProvider,
  extractClaudeImageMarkers,
  resolveClaudeImageMarkerPane,
  type ClaudeImageMarkerPaneState
} from './claude-image-marker-links'
import type { TerminalLinkActionContext } from './terminal-link-action-request'

const PANE_KEY = 'tab-1:4a0c1a3e-5f4f-4c3a-9b7e-0d1c2b3a4f5e'

const mocks = vi.hoisted(() => {
  const state: ClaudeImageMarkerPaneState = {
    agentStatusByPaneKey: {},
    paneForegroundAgentByPaneKey: {}
  }
  return { state }
})

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))

// Recorded with config/scripts/capture-agent-pty-transcript.mjs against Claude Code
// 2.1.289 at 100x30: two bracketed-paste image paths typed into the prompt.
// happy-dom replaces the global URL, so resolve the fixture through node:path.
const CAPTURE = readFileSync(
  join(import.meta.dirname, '../../../../main/runtime/__fixtures__/claude-image-paste-markers.txt'),
  'utf8'
)

async function captureTerminal(): Promise<Terminal> {
  const terminal = new Terminal({ allowProposedApi: true, cols: 100, rows: 30 })
  await new Promise<void>((resolve) => terminal.write(CAPTURE, resolve))
  return terminal
}

function findLine(terminal: Terminal, needle: string): number {
  const buffer = terminal.buffer.active
  for (let y = 0; y < buffer.length; y += 1) {
    if (buffer.getLine(y)?.translateToString(true).includes(needle)) {
      return y + 1
    }
  }
  throw new Error(`no buffer line contains ${needle}`)
}

const clearSelection = vi.fn()

function linksAt(
  terminal: Terminal,
  bufferLineNumber: number,
  linkActionContext: TerminalLinkActionContext | null = null
): Promise<ILink[]> {
  const provider = createClaudeImageMarkerLinkProvider({
    // Headless xterm has no selection model.
    getTerminal: () => ({ buffer: terminal.buffer, clearSelection }),
    getPaneKey: () => PANE_KEY,
    isRuntimeOwned: () => false,
    linkTooltip: { textContent: '', style: { display: 'none' } },
    getLinkActionContext: () => linkActionContext
  })
  return new Promise((resolve) => {
    provider.provideLinks(bufferLineNumber, (links) => resolve(links ?? []))
  })
}

function claudePane(sessionId = 'session-1'): void {
  mocks.state.agentStatusByPaneKey = {
    [PANE_KEY]: {
      agentType: 'claude',
      providerSession: { id: sessionId, transcriptPath: '/home/u/.claude/projects/p/s.jsonl' }
    }
  }
}

beforeEach(() => {
  vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  clearSelection.mockClear()
  mocks.state.agentStatusByPaneKey = {}
  mocks.state.paneForegroundAgentByPaneKey = {}
  useTerminalImagePreviewStore.getState().closeTerminalImagePreview()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractClaudeImageMarkers', () => {
  it('finds every chip with its paste id and column span', () => {
    expect(extractClaudeImageMarkers('❯ [Image #1] [Image #12] compare')).toEqual([
      { pasteId: 1, text: '[Image #1]', startIndex: 2, endIndex: 12 },
      { pasteId: 12, text: '[Image #12]', startIndex: 13, endIndex: 24 }
    ])
  })

  it('ignores lookalikes that are not Claude chips', () => {
    expect(extractClaudeImageMarkers('[Image #0] [Image #x] [Image 3] Image #4')).toEqual([])
  })
})

describe('resolveClaudeImageMarkerPane', () => {
  it('returns the hook-reported Claude session', () => {
    claudePane('abc')
    expect(resolveClaudeImageMarkerPane(mocks.state, PANE_KEY)).toEqual({
      paneKey: PANE_KEY,
      agent: 'claude',
      sessionId: 'abc',
      transcriptPath: '/home/u/.claude/projects/p/s.jsonl'
    })
  })

  it('falls back to the foreground process before any hook has reported', () => {
    mocks.state.paneForegroundAgentByPaneKey = { [PANE_KEY]: { agent: 'claude' } }
    expect(resolveClaudeImageMarkerPane(mocks.state, PANE_KEY)).toMatchObject({
      agent: 'claude',
      sessionId: null
    })
  })

  it('leaves panes running other agents alone', () => {
    mocks.state.agentStatusByPaneKey = { [PANE_KEY]: { agentType: 'codex' } }
    expect(resolveClaudeImageMarkerPane(mocks.state, PANE_KEY)).toBeNull()
  })
})

describe('createClaudeImageMarkerLinkProvider on a captured Claude Code screen', () => {
  it('links both chips even though Claude paints the second one in two writes', async () => {
    claudePane()
    const terminal = await captureTerminal()
    const links = await linksAt(terminal, findLine(terminal, '[Image #1]'))

    expect(links.map((link) => link.text)).toEqual(['[Image #1]', '[Image #2]'])
    const line = terminal.buffer.active.getLine(links[0]!.range.start.y - 1)!.translateToString()
    for (const link of links) {
      expect(line.slice(link.range.start.x - 1, link.range.end.x)).toBe(link.text)
    }
  })

  it('provides no links when the pane is not running Claude', async () => {
    const terminal = await captureTerminal()
    await expect(linksAt(terminal, findLine(terminal, '[Image #1]'))).resolves.toEqual([])
  })

  it('opens the preview for the clicked chip on Cmd+click', async () => {
    claudePane('session-9')
    const terminal = await captureTerminal()
    const [, second] = await linksAt(terminal, findLine(terminal, '[Image #1]'))

    second!.activate(new MouseEvent('click', { metaKey: true }), second!.text)

    expect(useTerminalImagePreviewStore.getState().request).toEqual({
      paneKey: PANE_KEY,
      agent: 'claude',
      sessionId: 'session-9',
      transcriptPath: '/home/u/.claude/projects/p/s.jsonl',
      pasteId: 2,
      canReadTranscript: true
    })
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })

  it('ignores a plain click when no link action context is available', async () => {
    claudePane()
    const terminal = await captureTerminal()
    const [first] = await linksAt(terminal, findLine(terminal, '[Image #1]'))

    first!.activate(new MouseEvent('click'), first!.text)

    expect(useTerminalImagePreviewStore.getState().request).toBeNull()
  })
})
