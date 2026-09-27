import { translate } from '@/i18n/i18n'
import type { DatabaseKeyInfo } from '../../../../../shared/database/database-introspection-types'
import type { DatabaseExplorerFolder } from './database-explorer-tree'

export function folderLabel(folder: DatabaseExplorerFolder): string {
  switch (folder) {
    case 'routines':
      return translate('database.explorer.routines', 'Routines')
    case 'keys':
      return translate('database.explorer.keys', 'Keys')
    case 'indexes':
      return translate('database.explorer.indexes', 'Indexes')
  }
}

function keyKindLabel(kind: DatabaseKeyInfo['kind']): string {
  switch (kind) {
    case 'primary':
      return translate('database.explorer.primaryKey', 'Primary key')
    case 'unique':
      return translate('database.explorer.uniqueKey', 'Unique key')
    case 'foreign':
      return translate('database.explorer.foreignKey', 'Foreign key')
  }
}

/** `name` falls back to the kind for keys the server leaves unnamed (SQLite). */
export function constraintLabel(key: DatabaseKeyInfo): { name: string; detail: string } {
  const columns = `(${key.columns.join(', ')})`
  const target = key.references
    ? ` → ${key.references.relation}(${key.references.columns.join(', ')})`
    : ''
  return { name: key.name || keyKindLabel(key.kind), detail: `${columns}${target}` }
}
