import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}))

vi.mock('sonner', () => ({ toast }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values: Record<string, string> = {}) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '')
}))

import { showCodeNavigationStatus } from './code-navigation-status-toasts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('showCodeNavigationStatus', () => {
  it('names the Vue server', () => {
    showCodeNavigationStatus({ kind: 'vue', root: '/repo/shop', phase: 'failed', message: 'boom' })

    expect(toast.error).toHaveBeenCalledWith('Vue code navigation is unavailable: boom', {
      id: 'code-navigation:vue:/repo/shop'
    })
  })

  it("hints at nuxi prepare in a toast the server's 'ready' does not dismiss", () => {
    showCodeNavigationStatus({ kind: 'vue', root: '/repo/shop', phase: 'nuxtTypesMissing' })
    showCodeNavigationStatus({ kind: 'vue', root: '/repo/shop', phase: 'ready' })

    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('Run `nuxi prepare` in shop.'),
      {
        id: 'code-navigation:vue:/repo/shop:nuxt-types',
        duration: 12_000
      }
    )
    expect(toast.dismiss).toHaveBeenCalledWith('code-navigation:vue:/repo/shop')
  })
})
