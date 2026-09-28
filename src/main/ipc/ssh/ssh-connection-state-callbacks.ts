import type { SshConnectionCallbacks } from '../../ssh/connection/ssh-connection-callbacks'
import type { SshConnectionState } from '../../../shared/ssh-types'
import { isSshHostCensusInFlight } from '../../ssh/connection/ssh-connection-attribution'
import {
  clearSshCredentialDeclined,
  isSshCredentialDeclined
} from '../../ssh/ssh-credential-decline'
import {
  connectInFlight,
  credentialRequestedForTarget,
  testingTargets
} from './ssh-connect-attempt-registry'
import { connectionManager, getCurrentMainWindow } from './ssh-ipc-context'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import { recordSshSignInRequirement } from './ssh-sign-in-requirement'
import { restoreManagedHostPortForwards } from './ssh-managed-port-forward-restore'
import { requestSshCredential } from './ssh-passphrase'
import { broadcastSshState } from './ssh-renderer-broadcast'

export function handleSshConnectionStateChange(targetId: string, state: SshConnectionState): void {
  if (state.status === 'connected') {
    clearSshCredentialDeclined(targetId)
    recordSshSignInRequirement(targetId, getSshTargetRegistryStore(), connectionManager)
  }
  if (testingTargets.has(targetId)) {
    return
  }
  if (
    state.status === 'connected' &&
    (connectInFlight.has(targetId) || isSshHostCensusInFlight(targetId))
  ) {
    // Why: the raw transport reaches 'connected' while the connect is still deciding the host's
    // server; forwarding it would let the renderer treat the host as up before anything serves it.
    broadcastSshState(getCurrentMainWindow, targetId, {
      targetId,
      status: 'connecting',
      error: state.error,
      reconnectAttempt: state.reconnectAttempt
    })
    return
  }
  broadcastSshState(getCurrentMainWindow, targetId, state)
  // An explicit connect restores through its own publish; this covers a transport that recovered.
  if (state.status === 'connected') {
    void restoreManagedHostPortForwards(targetId)
  }
}

export function createSshConnectionCallbacks(): SshConnectionCallbacks {
  return {
    onCredentialRequest: async (targetId, kind, detail, echo, signal) => {
      // Why: after a Cancel only an explicit connect may prompt; answer the rest as cancelled.
      if (isSshCredentialDeclined(targetId, signal)) {
        return null
      }
      const answer = await requestSshCredential(
        getCurrentMainWindow,
        targetId,
        kind,
        detail,
        echo,
        signal
      )
      // Why: a remembered passphrase won't prompt next time, so startup can connect this target eagerly.
      if (answer.asksAgain && !signal?.aborted) {
        credentialRequestedForTarget.add(targetId)
      }
      return answer.value
    },
    onStateChange: handleSshConnectionStateChange
  }
}
