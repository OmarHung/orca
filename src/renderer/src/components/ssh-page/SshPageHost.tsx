import { Suspense, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { RecoverableRenderErrorBoundary } from '../error-boundaries/RecoverableRenderErrorBoundary'

const SshPage = lazy(() => import('./SshPage'))

/**
 * Keeps the SSH page mounted after its first visit and only hides it on other views, so its
 * terminals are never unmounted: a fail-open local PTY would respawn as a bare shell on remount.
 */
export function SshPageHost(): React.JSX.Element | null {
  const isVisible = useAppStore((s) => s.activeView === 'ssh')
  const [hasVisited, setHasVisited] = useState(isVisible)
  if (isVisible && !hasVisited) {
    setHasVisited(true)
  }
  if (!hasVisited) {
    return null
  }

  return (
    <div data-ssh-page className={isVisible ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <Suspense fallback={null}>
        <RecoverableRenderErrorBoundary
          boundaryId="page.ssh"
          surface="page"
          resetKey="ssh"
          title={translate('auto.App.b7a714db1e', 'This page hit an error.')}
          description={translate(
            'auto.App.03a14f6b5b',
            'Retry the page or navigate to another Orca surface.'
          )}
        >
          <SshPage isVisible={isVisible} />
        </RecoverableRenderErrorBoundary>
      </Suspense>
    </div>
  )
}
