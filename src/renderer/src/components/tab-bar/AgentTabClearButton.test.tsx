// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearAgentTabConversation: vi.fn(),
  resolveAgentTabClearTarget: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setContextualToursBlockingSurfaceVisible: vi.fn() })
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))
vi.mock('@/lib/agent-catalog', () => ({ getAgentLabel: () => 'Claude Code' }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('./agent-tab-clear', () => ({
  clearAgentTabConversation: mocks.clearAgentTabConversation,
  resolveAgentTabClearTarget: mocks.resolveAgentTabClearTarget
}))

import { ConfirmationDialogProvider } from '../confirmation-dialog'
import { AgentTabClearButton } from './AgentTabClearButton'

type ButtonOptions = { isBusy?: boolean; agent?: TuiAgent; shown?: boolean }

function tree({ isBusy = false, agent = 'claude', shown = true }: ButtonOptions = {}) {
  return (
    <ConfirmationDialogProvider>
      {shown ? (
        <AgentTabClearButton
          tabId="tab-1"
          tabTitle="Fix login"
          agent={agent}
          isActive
          isBusy={isBusy}
        />
      ) : null}
    </ConfirmationDialogProvider>
  )
}

function renderButton(options: ButtonOptions = {}): (next: ButtonOptions) => void {
  const { rerender } = render(tree(options))
  return (next) => rerender(tree(next))
}

const CHANGED = 'The agent in this tab changed while you were confirming, so nothing was cleared.'

const clearButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'Clear conversation in Fix login' })

describe('AgentTabClearButton', () => {
  beforeEach(() => {
    mocks.clearAgentTabConversation.mockReset().mockReturnValue('sent')
    mocks.resolveAgentTabClearTarget.mockReset().mockReturnValue('pty-1')
    mocks.toastError.mockReset()
  })
  afterEach(cleanup)

  it('sends /clear only after the user confirms', async () => {
    renderButton()

    await userEvent.click(clearButton())
    expect(await screen.findByText('Clear this conversation?')).toBeInTheDocument()
    expect(mocks.clearAgentTabConversation).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() =>
      expect(mocks.clearAgentTabConversation).toHaveBeenCalledWith('tab-1', 'claude', 'pty-1')
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('does nothing when the user cancels', async () => {
    renderButton()

    await userEvent.click(clearButton())
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText('Clear this conversation?')).toBeNull())
    expect(mocks.clearAgentTabConversation).not.toHaveBeenCalled()
  })

  it('does not open the dialog while the agent is busy', async () => {
    renderButton({ isBusy: true })

    expect(clearButton()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Wait for the agent to finish before clearing')).toBeInTheDocument()
    await userEvent.click(clearButton())

    expect(screen.queryByText('Clear this conversation?')).toBeNull()
    expect(mocks.clearAgentTabConversation).not.toHaveBeenCalled()
  })

  it('reports a tab without a running agent before asking', async () => {
    mocks.resolveAgentTabClearTarget.mockReturnValue(null)
    renderButton()

    await userEvent.click(clearButton())

    expect(mocks.toastError).toHaveBeenCalledWith('This tab has no running agent to clear.')
    expect(screen.queryByText('Clear this conversation?')).toBeNull()
  })

  it('sends nothing when the agent exits while the dialog is open', async () => {
    const rerender = renderButton()

    await userEvent.click(clearButton())
    await screen.findByText('Clear this conversation?')
    rerender({ shown: false })
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(CHANGED))
    expect(mocks.clearAgentTabConversation).not.toHaveBeenCalled()
  })

  it('sends nothing when a different agent took over while the dialog was open', async () => {
    const rerender = renderButton()

    await userEvent.click(clearButton())
    await screen.findByText('Clear this conversation?')
    rerender({ agent: 'codex' })
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(CHANGED))
    expect(mocks.clearAgentTabConversation).not.toHaveBeenCalled()
  })

  it.each([
    ['busy', 'Wait for the agent to finish before clearing'],
    ['changed', CHANGED]
  ])('explains a %s tab found at send time', async (outcome, message) => {
    mocks.clearAgentTabConversation.mockReturnValue(outcome)
    renderButton()

    await userEvent.click(clearButton())
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(message))
  })

  it('renders nothing without a confirmation dialog host', () => {
    render(
      <AgentTabClearButton
        tabId="tab-1"
        tabTitle="Fix login"
        agent="claude"
        isActive
        isBusy={false}
      />
    )

    expect(screen.queryByRole('button')).toBeNull()
  })
})
