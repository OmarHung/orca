import { app } from 'electron'
import type { UpdateStatus } from '../../shared/update-status-types'
import { readForkSourceIdentity } from './fork-source-identity'
import { listUpstreamTags, runForkSync } from './fork-source-runtime'
import { ForkSourceUpdater } from './fork-source-updater'

/** First background check waits for startup to settle; then every few hours like release checks. */
const FIRST_CHECK_DELAY_MS = 60_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type HostUpdater = {
  suppressReleaseChecks: () => void
  publishExternalStatus: (status: UpdateStatus) => void
  installLocalBuild: (manifestPath: string) => Promise<void>
}

let forkUpdater: ForkSourceUpdater | null = null

/** The fork updater for a build made from this fork's source; null for official builds. */
export function getForkSourceUpdater(): ForkSourceUpdater | null {
  return forkUpdater
}

/** Call before the host updater starts, so its first background release check is already off. */
export function initForkSourceUpdater(host: HostUpdater): void {
  if (forkUpdater || !app.isPackaged) {
    return
  }
  let identity: ReturnType<typeof readForkSourceIdentity> = null
  try {
    identity = readForkSourceIdentity(app.getAppPath())
  } catch {
    // Why swallow: fork detection must never break the regular updater for official builds.
    identity = null
  }
  if (!identity) {
    return
  }
  host.suppressReleaseChecks()
  const updater = new ForkSourceUpdater({
    identity,
    publish: (status) => host.publishExternalStatus(status),
    listUpstreamTags: () => listUpstreamTags(identity),
    runSync: (targetTag, onEvent) => runForkSync(identity, targetTag, onEvent),
    installLocalBuild: (manifestPath) => host.installLocalBuild(manifestPath)
  })
  forkUpdater = updater
  const backgroundCheck = (): void => {
    // Why skip once actionable: a rebuilt or conflicted state must not be replaced by "available".
    if (!updater.ownsActions()) {
      void updater.check(false)
    }
  }
  setTimeout(backgroundCheck, FIRST_CHECK_DELAY_MS).unref?.()
  setInterval(backgroundCheck, CHECK_INTERVAL_MS).unref?.()
}
