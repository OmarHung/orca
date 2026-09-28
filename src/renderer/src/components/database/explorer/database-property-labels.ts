import { translate } from '@/i18n/i18n'
import type {
  DatabasePropertyKey,
  DatabasePropertySectionKind
} from '../../../../../shared/database/database-properties-types'

// Why one call per key: the localization catalog is read from literal translate() keys.
const LABELS: Record<DatabasePropertyKey, () => string> = {
  version: () => translate('database.properties.version', 'Version'),
  edition: () => translate('database.properties.edition', 'Edition'),
  defaultEngine: () => translate('database.properties.defaultEngine', 'Default engine'),
  timeZone: () => translate('database.properties.timeZone', 'Time zone'),
  owner: () => translate('database.properties.owner', 'Owner'),
  encoding: () => translate('database.properties.encoding', 'Encoding'),
  characterSet: () => translate('database.properties.characterSet', 'Character set'),
  collation: () => translate('database.properties.collation', 'Collation'),
  ctype: () => translate('database.properties.ctype', 'Character classification'),
  localeProvider: () => translate('database.properties.localeProvider', 'Locale provider'),
  locale: () => translate('database.properties.locale', 'Locale'),
  tablespace: () => translate('database.properties.tablespace', 'Tablespace'),
  connectionLimit: () => translate('database.properties.connectionLimit', 'Connection limit'),
  allowConnections: () => translate('database.properties.allowConnections', 'Allows connections'),
  isTemplate: () => translate('database.properties.isTemplate', 'Template'),
  compatibilityLevel: () =>
    translate('database.properties.compatibilityLevel', 'Compatibility level'),
  recoveryModel: () => translate('database.properties.recoveryModel', 'Recovery model'),
  state: () => translate('database.properties.state', 'State'),
  readOnly: () => translate('database.properties.readOnly', 'Read-only'),
  snapshotIsolation: () => translate('database.properties.snapshotIsolation', 'Snapshot isolation'),
  readCommittedSnapshot: () =>
    translate('database.properties.readCommittedSnapshot', 'Read committed snapshot'),
  containment: () => translate('database.properties.containment', 'Containment'),
  encryption: () => translate('database.properties.encryption', 'Encryption'),
  tableCount: () => translate('database.properties.tableCount', 'Tables'),
  file: () => translate('database.properties.file', 'File'),
  pageSize: () => translate('database.properties.pageSize', 'Page size'),
  pageCount: () => translate('database.properties.pageCount', 'Pages'),
  freePages: () => translate('database.properties.freePages', 'Free pages'),
  journalMode: () => translate('database.properties.journalMode', 'Journal mode'),
  autoVacuum: () => translate('database.properties.autoVacuum', 'Auto-vacuum'),
  userVersion: () => translate('database.properties.userVersion', 'User version'),
  applicationId: () => translate('database.properties.applicationId', 'Application ID'),
  type: () => translate('database.properties.type', 'Type'),
  engine: () => translate('database.properties.engine', 'Engine'),
  rowFormat: () => translate('database.properties.rowFormat', 'Row format'),
  persistence: () => translate('database.properties.persistence', 'Persistence'),
  accessMethod: () => translate('database.properties.accessMethod', 'Access method'),
  options: () => translate('database.properties.options', 'Options'),
  partitionKey: () => translate('database.properties.partitionKey', 'Partition key'),
  partitionOf: () => translate('database.properties.partitionOf', 'Partition of'),
  rowSecurity: () => translate('database.properties.rowSecurity', 'Row-level security'),
  memoryOptimized: () => translate('database.properties.memoryOptimized', 'Memory-optimized'),
  durability: () => translate('database.properties.durability', 'Durability'),
  temporalType: () => translate('database.properties.temporalType', 'Temporal type'),
  lockEscalation: () => translate('database.properties.lockEscalation', 'Lock escalation'),
  filegroup: () => translate('database.properties.filegroup', 'Filegroup'),
  withoutRowid: () => translate('database.properties.withoutRowid', 'WITHOUT ROWID'),
  strict: () => translate('database.properties.strict', 'STRICT'),
  columnCount: () => translate('database.properties.columnCount', 'Columns'),
  autoIncrement: () => translate('database.properties.autoIncrement', 'Next auto-increment value'),
  rowsEstimate: () => translate('database.properties.rowsEstimate', 'Rows (estimated)'),
  dataSize: () => translate('database.properties.dataSize', 'Data size'),
  indexSize: () => translate('database.properties.indexSize', 'Index size'),
  dataFree: () => translate('database.properties.dataFree', 'Free space'),
  size: () => translate('database.properties.size', 'Size'),
  createOptions: () => translate('database.properties.createOptions', 'Create options'),
  definer: () => translate('database.properties.definer', 'Definer'),
  securityType: () => translate('database.properties.securityType', 'Security'),
  checkOption: () => translate('database.properties.checkOption', 'Check option'),
  updatable: () => translate('database.properties.updatable', 'Updatable'),
  schemaBound: () => translate('database.properties.schemaBound', 'Schema-bound'),
  populated: () => translate('database.properties.populated', 'Populated'),
  created: () => translate('database.properties.created', 'Created'),
  modified: () => translate('database.properties.modified', 'Definition changed'),
  dataUpdated: () => translate('database.properties.dataUpdated', 'Data changed'),
  comment: () => translate('database.properties.comment', 'Comment')
}

export function propertyLabel(key: DatabasePropertyKey): string {
  return LABELS[key]()
}

export function propertySectionLabel(kind: DatabasePropertySectionKind): string {
  switch (kind) {
    case 'server':
      return translate('database.properties.sectionServer', 'Server')
    case 'database':
      return translate('database.properties.sectionDatabase', 'Database')
    case 'schema':
      return translate('database.properties.sectionSchema', 'Schema')
    case 'table':
      return translate('database.properties.sectionTable', 'Table')
    case 'view':
      return translate('database.properties.sectionView', 'View')
  }
}

export type ColumnField =
  | 'name'
  | 'dataType'
  | 'nullable'
  | 'defaultValue'
  | 'characterSet'
  | 'collation'
  | 'comment'

export function columnFieldLabel(field: ColumnField): string {
  switch (field) {
    case 'name':
      return translate('database.properties.columnName', 'Name')
    case 'dataType':
      return translate('database.properties.columnType', 'Type')
    case 'nullable':
      return translate('database.properties.columnNullable', 'Nullable')
    case 'defaultValue':
      return translate('database.properties.columnDefault', 'Default')
    case 'characterSet':
      return translate('database.properties.characterSet', 'Character set')
    case 'collation':
      return translate('database.properties.collation', 'Collation')
    case 'comment':
      return translate('database.properties.comment', 'Comment')
  }
}
