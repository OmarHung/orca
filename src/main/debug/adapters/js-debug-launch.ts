import { connectTcpDapTransport } from '../dap-transport-tcp'
import { ensureDebugAdapterInstalled } from './adapter-installer'
import { JS_DEBUG_ARTIFACT } from './adapter-manifest'
import {
  buildNodeLaunchArguments,
  createJsDebugInstallDeps,
  startJsDebugServer,
  type NodeLaunchTarget
} from './js-debug-adapter'
import type { AdapterPreparation, PreparedDebugAdapter } from './prepared-debug-adapter'

export async function prepareJsDebug(
  context: AdapterPreparation,
  target: NodeLaunchTarget
): Promise<PreparedDebugAdapter> {
  context.onInstalling()
  const installDir = await ensureDebugAdapterInstalled(
    JS_DEBUG_ARTIFACT,
    context.adaptersDir,
    createJsDebugInstallDeps()
  )
  const server = await startJsDebugServer(installDir)
  try {
    const connect = () => connectTcpDapTransport(server.host, server.port)
    return {
      adapterId: 'pwa-node',
      transport: await connect(),
      openChildTransport: connect,
      launchArguments: buildNodeLaunchArguments({ target, cwd: context.cwd }),
      diagnostics: () => '',
      dispose: server.dispose
    }
  } catch (error) {
    server.dispose()
    throw error
  }
}
