import { lazyWithRetry as lazy } from '@/app-shell/startup/lazy-with-retry'
import { KeptMountedPage } from './KeptMountedPage'

const SshPage = lazy(() => import('./SshPage'))

export function SshPageHost(): React.JSX.Element {
  return (
    <KeptMountedPage view="ssh">{(isVisible) => <SshPage isVisible={isVisible} />}</KeptMountedPage>
  )
}
