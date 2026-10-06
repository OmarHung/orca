import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { NgrokShareRequest } from '../../../../shared/ngrok/ngrok-types'
import {
  findRunConfiguration,
  type RunConfigurationNgrok
} from '../../../../shared/run-configurations/run-configuration-definition'
import { isLiveDebugSession, useDebugStore } from '../debug/debug-store'
import { combineRunConfigurations, useRunConfigurationStore } from '../run/run-configuration-store'
import { debugPortOwnerKey, liveClaimedPorts, runPortOwnerKey } from '../run/run-port-claims'
import { isHiddenRunPort, useRunPortStore } from '../run/run-port-store'
import { worktreeRuntimeTarget } from '../run/run-port-tracking'
import { isRunSessionActive, useRunSessionStore } from '../run/run-session-store'
import { configurationIdOfCommandKey } from '../run/run-widget-items'
import { endpointsForPort, shareTargetForPort } from './ngrok-port-targets'
import {
  planAutoShare,
  type AutoShareRecord,
  type AutoShareSession
} from './ngrok-run-auto-share-plan'
import { LOCAL_SCAN_KEY, shareWithNgrok, stopNgrokEndpoint, useNgrokStore } from './ngrok-store'

type Candidate = { ownerKey: string; attemptId: string; worktreeId: string; sourceKey?: string }

let records: Record<string, AutoShareRecord> = {}

/** The `ngrok` option of the saved configuration a session started from, if any. */
function ngrokOptionOf(candidate: Candidate): RunConfigurationNgrok | null {
  const id = candidate.sourceKey ? configurationIdOfCommandKey(candidate.sourceKey) : null
  if (!id) {
    return null
  }
  const repoId = findWorktreeById(
    useAppStore.getState().worktreesByRepo,
    candidate.worktreeId
  )?.repoId
  const { localByRepo, sharedByWorktree } = useRunConfigurationStore.getState()
  const listed = combineRunConfigurations(
    repoId ? (localByRepo[repoId] ?? []) : [],
    sharedByWorktree[candidate.worktreeId]?.configurations ?? []
  )
  const configuration = findRunConfiguration(
    listed.map((entry) => entry.configuration),
    id
  )
  return configuration?.type === 'command' || configuration?.type === 'debug'
    ? (configuration.ngrok ?? null)
    : null
}

function shareTargetOf(ownerKey: string, option: RunConfigurationNgrok): NgrokShareRequest | null {
  const scans = useAppStore.getState().workspacePortScansByKey
  const { claimsByOwner, probesByPortId } = useRunPortStore.getState()
  const claim = claimsByOwner[ownerKey]
  const claimed = claim
    ? liveClaimedPorts([claim], scans, (port) => isHiddenRunPort(probesByPortId, port))
    : []
  if (option.port === undefined) {
    return claimed[0] ? shareTargetForPort(claimed[0]) : null
  }
  // Why the whole scan: a named port may sit behind a forwarder no claim ties to the session.
  const listener =
    claimed.find((port) => port.port === option.port) ??
    scans[LOCAL_SCAN_KEY]?.ports.find((port) => port.port === option.port)
  return listener ? shareTargetForPort(listener) : null
}

function candidates(): Candidate[] {
  const runs = Object.values(useRunSessionStore.getState().sessionsByKey)
    .filter((session) => isRunSessionActive(session.status))
    .map((session) => ({
      ownerKey: runPortOwnerKey(session.key),
      attemptId: session.attemptId,
      worktreeId: session.worktreeId,
      sourceKey: session.commandKey
    }))
  const debugSessions = useDebugStore
    .getState()
    .sessions.filter(isLiveDebugSession)
    .map((session) => ({
      ownerKey: debugPortOwnerKey(session.id),
      attemptId: session.id,
      worktreeId: session.worktreeId,
      sourceKey: session.sourceKey
    }))
  return [...runs, ...debugSessions]
}

function autoShareSessions(): AutoShareSession[] {
  return candidates().flatMap((candidate) => {
    // Why local only: Orca's agent runs here and cannot reach another host's loopback.
    if (worktreeRuntimeTarget(candidate.worktreeId)?.kind !== 'local') {
      return []
    }
    const option = ngrokOptionOf(candidate)
    return option
      ? [
          {
            ownerKey: candidate.ownerKey,
            attemptId: candidate.attemptId,
            target: shareTargetOf(candidate.ownerKey, option)
          }
        ]
      : []
  })
}

async function share(
  ownerKey: string,
  attemptId: string,
  target: NgrokShareRequest
): Promise<void> {
  const endpoint = await shareWithNgrok(target)
  if (!endpoint) {
    return
  }
  const record = records[ownerKey]
  if (record?.attemptId !== attemptId) {
    // The session ended (or reran) while the endpoint was coming up.
    void stopNgrokEndpoint(endpoint)
    return
  }
  records = { ...records, [ownerKey]: { ...record, endpoint } }
}

function evaluate(): void {
  const { snapshot } = useNgrokStore.getState()
  // Why wait for a snapshot: before it, a port shared before a reload would look unshared.
  if (!snapshot?.installed) {
    return
  }
  const plan = planAutoShare(
    autoShareSessions(),
    records,
    (port) => endpointsForPort(snapshot, port)[0] ?? null
  )
  records = plan.records
  for (const endpoint of plan.stop) {
    void stopNgrokEndpoint(endpoint)
  }
  for (const request of plan.share) {
    void share(request.ownerKey, request.attemptId, request.target)
  }
}

let evaluateQueued = false

function scheduleEvaluate(): void {
  if (evaluateQueued) {
    return
  }
  evaluateQueued = true
  queueMicrotask(() => {
    evaluateQueued = false
    evaluate()
  })
}

function installNgrokRunAutoShare(): () => void {
  const unsubscribers = [
    useRunSessionStore.subscribe(scheduleEvaluate),
    useDebugStore.subscribe(scheduleEvaluate),
    useRunPortStore.subscribe(scheduleEvaluate),
    useRunConfigurationStore.subscribe(scheduleEvaluate),
    useNgrokStore.subscribe((state, previous) => {
      if (state.snapshot !== previous.snapshot) {
        scheduleEvaluate()
      }
    }),
    useAppStore.subscribe((state, previous) => {
      if (state.workspacePortScansByKey !== previous.workspacePortScansByKey) {
        scheduleEvaluate()
      }
    })
  ]
  scheduleEvaluate()
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}

const disposeNgrokRunAutoShare = installNgrokRunAutoShare()

if (import.meta !== undefined && import.meta.hot) {
  import.meta.hot.dispose(disposeNgrokRunAutoShare)
}
