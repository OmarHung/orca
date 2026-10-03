import React, { Suspense, lazy, useEffect } from 'react'
import {
  getForkUpdateChangelogApi,
  useForkUpdateChangelogStore
} from './fork-update-changelog-store'
import { useChangelogLocale } from './use-changelog-locale'

const ForkUpdateChangelogDialog = lazy(() =>
  import('./ForkUpdateChangelogDialog').then((module) => ({
    default: module.ForkUpdateChangelogDialog
  }))
)

/** Loads the fork build's changelog and opens it once after an update to a new upstream tag. */
export function ForkUpdateChangelogHost(): React.JSX.Element | null {
  const changelog = useForkUpdateChangelogStore((s) => s.changelog)
  const isOpen = useForkUpdateChangelogStore((s) => s.isOpen)
  const locale = useChangelogLocale()

  useEffect(() => {
    const api = getForkUpdateChangelogApi()
    if (!api) {
      return
    }
    const { setChangelog, openDialog } = useForkUpdateChangelogStore.getState()
    let disposed = false
    const unsubscribe = api.onChanged((next) => setChangelog(next))
    void api.get().then((initial) => {
      if (disposed) {
        return
      }
      setChangelog(initial)
      if (initial && !initial.seen) {
        openDialog()
      }
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (isOpen && locale) {
      // Why on open: the summary follows the UI language when it is read, not when it updated.
      void getForkUpdateChangelogApi()?.ensureSummary(locale)
    }
  }, [isOpen, locale])

  if (!isOpen || !changelog) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <ForkUpdateChangelogDialog changelog={changelog} locale={locale} />
    </Suspense>
  )
}
