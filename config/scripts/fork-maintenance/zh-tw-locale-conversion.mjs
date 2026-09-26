// Pure pieces of the Simplified → Traditional (Taiwan) catalog conversion, kept apart from the
// OpenCC download so they can be tested without it.

/**
 * Applies the term corrections OpenCC's Taiwan phrase table does not make, in order.
 * @param {string} text
 * @param {{ from: string, to: string }[]} overrides `from` is a regular-expression source.
 * @returns {string}
 */
export function applyTermOverrides(text, overrides) {
  return overrides.reduce(
    (current, override) => current.replace(new RegExp(override.from, 'g'), override.to),
    text
  )
}

/**
 * Converts every string in a nested catalog, keeping its keys and shape.
 * @param {unknown} value
 * @param {(text: string) => string} convert
 * @returns {unknown}
 */
export function convertCatalog(value, convert) {
  if (typeof value === 'string') {
    return convert(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertCatalog(item, convert))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, convertCatalog(item, convert)])
    )
  }
  return value
}

/** Same layout as the other catalogs (two-space JSON with a trailing newline). */
export function formatCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`
}
