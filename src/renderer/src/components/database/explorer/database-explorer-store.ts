import { create } from 'zustand'
import { asDatabaseResult, useDatabaseConnectionsStore } from '../database-connections-store'
import { invalidateSqlCatalog } from '../console/sql-completion-catalog'
import {
  childNodesFor,
  connectionNode,
  connectionNodeKey,
  introspectTargetFor,
  isExpandableNode,
  type DatabaseExplorerChildren,
  type DatabaseExplorerNode
} from './database-explorer-tree'

type DatabaseExplorerState = {
  expanded: Record<string, boolean>
  children: Record<string, DatabaseExplorerChildren>
  selectedKey: string | null
  select: (key: string) => void
  toggle: (node: DatabaseExplorerNode) => Promise<void>
  /** Reloads a node's children, e.g. after DDL. */
  refresh: (node: DatabaseExplorerNode) => Promise<void>
  /** Expands a connection that just connected (after a password prompt, or Connect). */
  showConnected: (connectionId: string) => Promise<void>
  /** Drops a connection's cached tree when its session ends. */
  resetConnection: (connectionId: string) => void
}

function withoutConnection<T>(record: Record<string, T>, connectionId: string): Record<string, T> {
  const prefix = connectionNodeKey(connectionId)
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}/`))
  )
}

export const useDatabaseExplorerStore = create<DatabaseExplorerState>((set, get) => {
  const load = async (node: DatabaseExplorerNode): Promise<void> => {
    const target = introspectTargetFor(node)
    if (!target) {
      return
    }
    set((state) => ({ children: { ...state.children, [node.key]: { status: 'loading' } } }))
    const result = asDatabaseResult(await window.api.database.introspect(node.connectionId, target))
    const next: DatabaseExplorerChildren = result.ok
      ? { status: 'loaded', nodes: childNodesFor(node, result.value) }
      : { status: 'error', message: result.error.message }
    set((state) => ({ children: { ...state.children, [node.key]: next } }))
  }

  return {
    expanded: {},
    children: {},
    selectedKey: null,

    select: (key) => set({ selectedKey: key }),

    toggle: async (node) => {
      if (!isExpandableNode(node)) {
        return
      }
      if (get().expanded[node.key]) {
        set((state) => ({ expanded: { ...state.expanded, [node.key]: false } }))
        return
      }
      if (node.kind === 'connection') {
        // Expanding a data source connects it, as in DataGrip.
        const connected = await useDatabaseConnectionsStore.getState().connect(node.connectionId)
        if (!connected) {
          return
        }
      }
      set((state) => ({ expanded: { ...state.expanded, [node.key]: true } }))
      if (get().children[node.key]?.status !== 'loaded') {
        await load(node)
      }
    },

    refresh: (node) => {
      // A manual refresh is how users pick up changes made elsewhere; completion should too.
      invalidateSqlCatalog(node.connectionId)
      return load(node)
    },

    showConnected: async (connectionId) => {
      const node = connectionNode(connectionId)
      set((state) => ({ expanded: { ...state.expanded, [node.key]: true } }))
      await load(node)
    },

    resetConnection: (connectionId) =>
      set((state) => ({
        expanded: withoutConnection(state.expanded, connectionId),
        children: withoutConnection(state.children, connectionId)
      }))
  }
})
