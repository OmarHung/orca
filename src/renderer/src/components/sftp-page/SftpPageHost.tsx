import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { KeptMountedPage } from '../ssh-page/KeptMountedPage'

const SftpPage = lazy(() => import('./SftpPage'))

export function SftpPageHost(): React.JSX.Element {
  return (
    <KeptMountedPage view="sftp">
      {(isVisible) => <SftpPage isVisible={isVisible} />}
    </KeptMountedPage>
  )
}
