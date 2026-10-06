// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LinkActionRequest } from './link-action-request'

const mocks = vi.hoisted(() => ({
  openSettingsPage: vi.fn(),
  openSettingsTarget: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeClipboardText: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess }
}))

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      openSettingsPage: () => void
      openSettingsTarget: (target: unknown) => void
    }) => unknown
  ) =>
    selector({
      openSettingsPage: mocks.openSettingsPage,
      openSettingsTarget: mocks.openSettingsTarget
    })
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({
    children,
    open,
    onOpenChange
  }: {
    children: ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div>
        <button data-testid="dismiss-popover" onClick={() => onOpenChange(false)} />
        {children}
      </div>
    ) : null,
  PopoverAnchor: () => null,
  PopoverContent: ({
    children,
    className,
    onMouseDown
  }: {
    children: ReactNode
    className?: string
    onMouseDown?: (event: React.MouseEvent) => void
  }) => (
    <div className={className} onMouseDown={onMouseDown}>
      {children}
    </div>
  )
}))

import { LinkActionPopover } from './LinkActionPopover'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('LinkActionPopover', () => {
  it('leaves focus on the terminal while a row is pressed', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
    const request: LinkActionRequest = {
      anchorX: 100,
      anchorY: 200,
      destination: 'https://example.com',
      kind: 'url',
      primary: { external: false, label: 'Orca Browser', run: vi.fn() },
      alternate: { external: true, label: 'System Browser', run: vi.fn() },
      restoreFocus: vi.fn()
    }

    render(<LinkActionPopover request={request} onClose={vi.fn()} />)

    // fireEvent returns false when the default (moving focus) was prevented.
    expect(fireEvent.mouseDown(screen.getByText('Orca Browser'))).toBe(false)
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Copy link' }))).toBe(false)
  })
})
