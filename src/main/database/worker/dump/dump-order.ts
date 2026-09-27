export type DumpTableRef = { schema: string; name: string }

export type DumpTableNode = DumpTableRef & {
  /** Tables this one's foreign keys point at; others outside the dump are ignored. */
  references: DumpTableRef[]
}

export function tableKey(table: DumpTableRef): string {
  return JSON.stringify([table.schema, table.name])
}

/**
 * Tables in creation order, each after the tables it references. A cycle can't be ordered,
 * so the first of its tables (by position) is created anyway; `cyclic` names the tables whose
 * foreign keys must then be added after every table exists.
 */
export function orderTables<T extends DumpTableNode>(
  tables: readonly T[]
): { order: T[]; cyclic: Set<string> } {
  const byKey = new Map(tables.map((table) => [tableKey(table), table]))
  const pending = new Map(
    tables.map((table) => [
      tableKey(table),
      new Set(
        table.references.map(tableKey).filter((key) => key !== tableKey(table) && byKey.has(key))
      )
    ])
  )
  const order: T[] = []
  const cyclic = new Set<string>()
  while (pending.size > 0) {
    const ready = [...pending].find(([, waitsFor]) => waitsFor.size === 0)?.[0]
    const next = ready ?? [...pending.keys()][0]!
    if (!ready) {
      cyclic.add(next)
    }
    pending.delete(next)
    for (const waitsFor of pending.values()) {
      waitsFor.delete(next)
    }
    order.push(byKey.get(next)!)
  }
  return { order, cyclic }
}

function mentions(definition: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w$])${escaped}($|[^\\w$])`, 'i').test(definition)
}

/**
 * Views in an order that creates each after the views it selects from, read off their
 * definitions: a view naming another is taken to use it (a false match only moves it later).
 */
export function orderViews<T extends { name: string; definition: string }>(
  views: readonly T[]
): T[] {
  const remaining = [...views]
  const order: T[] = []
  while (remaining.length > 0) {
    const index = remaining.findIndex((view) =>
      remaining.every((other) => other === view || !mentions(view.definition, other.name))
    )
    // Why fall back to the first: definitions can't be cyclic, but a false match can look it.
    const [next] = remaining.splice(Math.max(index, 0), 1)
    order.push(next!)
  }
  return order
}
