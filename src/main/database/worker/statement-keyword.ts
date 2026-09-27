/** The statement's first keyword (`UPDATE`, `CREATE`…), used to label command results. */
export function leadingKeyword(sql: string): string {
  return /^[A-Za-z]+/.exec(sql.trimStart())?.[0]?.toUpperCase() ?? ''
}
