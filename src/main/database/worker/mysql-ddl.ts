import type mysql from 'mysql2'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import { queryMysqlRows } from './mysql-client-factory'

const NO_PRIVILEGE_MESSAGE =
  'The server didn’t return this definition; the user may lack the privilege to see it.'

/** SHOW CREATE answers with a `Create Table`, `Create View`, `Create Function`… column. */
function createStatement(row: Record<string, unknown> | undefined): string | null {
  if (!row) {
    return null
  }
  const entry = Object.entries(row).find(([key]) => key.startsWith('Create ') && key !== 'Create')
  return typeof entry?.[1] === 'string' ? entry[1] : null
}

export async function mysqlDdl(
  client: mysql.Connection,
  target: DatabaseDdlTarget
): Promise<string> {
  const schema = quoteSqlName(target.schema, 'mysql')
  const sql =
    target.kind === 'relation'
      ? `SHOW CREATE TABLE ${schema}.${quoteSqlName(target.relation, 'mysql')}`
      : `SHOW CREATE ${target.routineKind === 'procedure' ? 'PROCEDURE' : 'FUNCTION'} ${schema}.${quoteSqlName(target.identity, 'mysql')}`
  const [row] = await queryMysqlRows(client, sql)
  const statement = createStatement(row)
  if (statement === null) {
    throw new Error(NO_PRIVILEGE_MESSAGE)
  }
  return `${statement.trim()};`
}
