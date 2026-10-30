import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitLogPullSource } from '../git-log-pull-source'
import { GitLogActionsContext, type GitLogActions } from './git-log-actions-context'
import { GitLogPullButton } from './GitLogPullButton'

type MenuItemProps = { children?: ReactNode; onSelect?: () => void }

const menuItems = vi.hoisted(() => ({ values: [] as MenuItemProps[] }))

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React_.createElement(React_.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuLabel: passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: (props: MenuItemProps) => {
      menuItems.values.push(props)
      return React_.createElement(React_.Fragment, null, props.children)
    }
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}))

const SOURCE: GitLogPullSource = {
  ref: 'refs/remotes/fork/team/feature',
  upstream: 'fork/team/feature',
  behind: 3
}

function render(source: GitLogPullSource | null, actions: GitLogActions | null): string {
  return renderToStaticMarkup(
    <GitLogActionsContext.Provider value={actions}>
      <GitLogPullButton source={source} />
    </GitLogActionsContext.Provider>
  )
}

describe('GitLogPullButton', () => {
  const run = vi.fn()
  const actions = (runningKind: GitLogActions['runningKind'] = null): GitLogActions => ({
    runningKind,
    currentBranchName: 'feature',
    run
  })

  beforeEach(() => {
    menuItems.values = []
    run.mockReset()
  })

  it('is hidden outside the Git Log', () => {
    expect(render(SOURCE, null)).toBe('')
  })

  it('pulls the upstream into the current branch by rebase or merge', () => {
    const markup = render(SOURCE, actions())

    expect(markup).toContain('Pull from fork/team/feature')
    expect(markup).toContain('Pull into “feature” Using Rebase')
    expect(markup).toContain('Pull into “feature” Using Merge')
    expect(markup).not.toContain('disabled=""')

    menuItems.values[0]?.onSelect?.()
    menuItems.values[1]?.onSelect?.()

    expect(run.mock.calls).toEqual([
      [{ kind: 'pull', ref: SOURCE.ref, strategy: 'rebase' }],
      [{ kind: 'pull', ref: SOURCE.ref, strategy: 'merge' }]
    ])
  })

  it('is disabled without an upstream, and while another action runs', () => {
    const noUpstream = render(null, actions())
    expect(noUpstream).toContain('disabled=""')
    expect(noUpstream).toContain('The current branch has no upstream branch to pull from')
    menuItems.values[0]?.onSelect?.()
    expect(run).not.toHaveBeenCalled()

    expect(render(SOURCE, actions('fetch'))).toContain('disabled=""')
  })
})
