// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkUpdateChangelog } from '../../../../shared/fork-update-changelog'
import { getDefaultSettings } from '../../../../shared/constants'
import { useAppStore } from '../../store'
import { ForkUpdateChangelogHost } from './ForkUpdateChangelogHost'
import { useForkUpdateChangelogStore } from './fork-update-changelog-store'

const changelog: ForkUpdateChangelog = {
  fromTag: 'v1.4.218',
  toTag: 'v1.4.219',
  releaseNotes: [
    {
      tag: 'v1.4.219',
      title: 'Orca 1.4.219',
      url: 'https://github.com/stablyai/orca/releases/tag/v1.4.219',
      publishedAt: '2026-10-02T00:00:00Z',
      body: '- Sparse presets'
    }
  ],
  forkCommits: [{ sha: 'f0feeec927240000', subject: 'feat: AI changelog after updates' }],
  summary: null,
  seen: false,
  createdAt: 1
}

let changed: ((next: ForkUpdateChangelog | null) => void) | null = null
const api = {
  get: vi.fn(),
  ensureSummary: vi.fn(),
  regenerate: vi.fn(),
  markSeen: vi.fn(),
  onChanged: vi.fn((callback: (next: ForkUpdateChangelog | null) => void) => {
    changed = callback
    return () => (changed = null)
  })
}

function installApi(withChangelogApi = true): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      shell: { openUrl: vi.fn() },
      ...(withChangelogApi ? { forkUpdateChangelog: api } : {})
    }
  })
}

function setUiLanguage(uiLanguage: 'zh-TW' | 'en'): void {
  act(() => useAppStore.setState({ settings: { ...getDefaultSettings('/tmp'), uiLanguage } }))
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  setUiLanguage('zh-TW')
  useForkUpdateChangelogStore.setState(useForkUpdateChangelogStore.getInitialState(), true)
  for (const fn of [api.get, api.ensureSummary, api.regenerate, api.markSeen]) {
    fn.mockReset().mockResolvedValue(undefined)
  }
  api.get.mockResolvedValue(changelog)
  installApi()
})

afterEach(() => {
  cleanup()
})

describe('ForkUpdateChangelogHost', () => {
  it('opens an unseen changelog and starts its summary in the UI locale', async () => {
    render(<ForkUpdateChangelogHost />)
    // Why the long wait: the first test pays for transforming the lazily loaded dialog.
    expect(
      await screen.findByText('Orca updated to v1.4.219', {}, { timeout: 15_000 })
    ).toBeTruthy()
    expect(screen.getByText('Summarizing the changes with AI…')).toBeTruthy()
    expect(api.ensureSummary).toHaveBeenCalledWith('zh-TW')
  })

  it('waits for settings before summarizing, then follows the chosen language', async () => {
    act(() => useAppStore.setState({ settings: null }))
    render(<ForkUpdateChangelogHost />)
    await screen.findByText('Orca updated to v1.4.219')
    expect(api.ensureSummary).not.toHaveBeenCalled()
    setUiLanguage('en')
    await waitFor(() => expect(api.ensureSummary).toHaveBeenCalledWith('en'))
    setUiLanguage('zh-TW')
    await waitFor(() => expect(api.ensureSummary).toHaveBeenLastCalledWith('zh-TW'))
  })

  it('stays closed for a changelog already seen', async () => {
    api.get.mockResolvedValue({ ...changelog, seen: true })
    render(<ForkUpdateChangelogHost />)
    await waitFor(() => expect(useForkUpdateChangelogStore.getState().changelog).not.toBeNull())
    expect(screen.queryByText('Orca updated to v1.4.219')).toBeNull()
    expect(api.ensureSummary).not.toHaveBeenCalled()
  })

  it('renders the summary when it arrives and marks the changelog seen on close', async () => {
    render(<ForkUpdateChangelogHost />)
    await screen.findByText('Orca updated to v1.4.219')
    act(() =>
      changed?.({
        ...changelog,
        summary: { status: 'ready', locale: 'en', markdown: '## Fixes', agentLabel: 'Claude' }
      })
    )
    expect(await screen.findByText('Fixes')).toBeTruthy()
    expect(screen.getByText('Changes since v1.4.218, summarized by Claude')).toBeTruthy()
    fireEvent.click(screen.getByText('Got it'))
    expect(api.markSeen).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('Orca updated to v1.4.219')).toBeNull())
  })

  it('shows a failed summary with a retry', async () => {
    api.get.mockResolvedValue({
      ...changelog,
      summary: { status: 'failed', locale: 'en', error: 'Claude failed: not logged in' }
    })
    render(<ForkUpdateChangelogHost />)
    expect(await screen.findByText('Claude failed: not logged in')).toBeTruthy()
    fireEvent.click(screen.getByText('Try again'))
    expect(api.regenerate).toHaveBeenCalledWith('zh-TW')
  })

  it('lists the fork commits behind a toggle', async () => {
    render(<ForkUpdateChangelogHost />)
    fireEvent.click(await screen.findByText('Fork commits (1)'))
    expect(screen.getByText('feat: AI changelog after updates')).toBeTruthy()
  })

  it('does nothing in renderers without the fork changelog bridge', async () => {
    installApi(false)
    render(<ForkUpdateChangelogHost />)
    await Promise.resolve()
    expect(api.get).not.toHaveBeenCalled()
  })
})
