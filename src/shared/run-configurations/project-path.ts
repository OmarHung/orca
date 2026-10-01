/** Joins with the separator the project folder already uses, so Windows paths stay Windows paths. */
export function joinProjectPath(dir: string, fileName: string): string {
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${separator}${fileName}`
}
