import type pg from 'pg'

type FieldType = Pick<pg.FieldDef, 'dataTypeID' | 'dataTypeModifier'>

const TYPE_NAMES_SQL = `
  select pg_catalog.format_type(t.oid, t.modifier) as name
  from unnest($1::oid[], $2::int4[]) with ordinality as t(oid, modifier, position)
  order by t.position`

function cacheKey(field: FieldType): string {
  return `${field.dataTypeID}:${field.dataTypeModifier}`
}

/** Resolves result-column types to SQL names (`varchar(255)`, enums, domains) via the server. */
export class PostgresTypeNames {
  private readonly names = new Map<string, string>()

  constructor(private readonly metaClient: pg.Client) {}

  async resolve(fields: readonly FieldType[]): Promise<string[]> {
    const missing = [...new Map(fields.map((field) => [cacheKey(field), field])).values()].filter(
      (field) => !this.names.has(cacheKey(field))
    )
    if (missing.length > 0) {
      try {
        const result = await this.metaClient.query<{ name: string | null }>(TYPE_NAMES_SQL, [
          missing.map((field) => field.dataTypeID),
          missing.map((field) => field.dataTypeModifier)
        ])
        missing.forEach((field, index) => {
          this.names.set(cacheKey(field), result.rows[index]?.name ?? `oid ${field.dataTypeID}`)
        })
      } catch {
        // Why: a type name is decoration; never fail a query over it.
        return fields.map((field) => this.names.get(cacheKey(field)) ?? `oid ${field.dataTypeID}`)
      }
    }
    return fields.map((field) => this.names.get(cacheKey(field)) ?? `oid ${field.dataTypeID}`)
  }
}
