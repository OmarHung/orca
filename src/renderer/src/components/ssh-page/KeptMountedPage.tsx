import { Suspense, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { RecoverableRenderErrorBoundary } from '../error-boundaries/RecoverableRenderErrorBoundary'

type KeptMountedPageProps = {
  view: 'ssh' | 'sftp'
  children: (isVisible: boolean) => React.ReactNode
}

/**
 * Mounts a page on its first visit and afterwards only hides it on other views, so switching
 * away never tears it down: the SSH page's terminals (a fail-open local PTY would respawn as a
 * bare shell on remount) and the SFTP page's host, folders and selections survive.
 */
export function KeptMountedPage({
  view,
  children
}: KeptMountedPageProps): React.JSX.Element | null {
  const isVisible = useAppStore((s) => s.activeView === view)
  const [hasVisited, setHasVisited] = useState(isVisible)
  if (isVisible && !hasVisited) {
    setHasVisited(true)
  }
  if (!hasVisited) {
    return null
  }

  return (
    <div
      {...{ [`data-${view}-page`]: '' }}
      className={isVisible ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
    >
      <Suspense fallback={null}>
        <RecoverableRenderErrorBoundary
          boundaryId={`page.${view}`}
          surface="page"
          resetKey={view}
          title={translate('auto.App.b7a714db1e', 'This page hit an error.')}
          description={translate(
            'auto.App.03a14f6b5b',
            'Retry the page or navigate to another Orca surface.'
          )}
        >
          {children(isVisible)}
        </RecoverableRenderErrorBoundary>
      </Suspense>
    </div>
  )
}
