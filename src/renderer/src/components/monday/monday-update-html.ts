import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul'
]

const ASSET_ID_IN_URL = /\/resources\/(\d+)\//

/** Which uploaded file an image or link in an update points at. */
export function mondayAssetIdOf(element: Element): string | null {
  const explicit = element.getAttribute('data-asset_id') ?? ''
  if (/^\d+$/.test(explicit)) {
    return explicit
  }
  const url = element.getAttribute('src') ?? element.getAttribute('href') ?? ''
  return ASSET_ID_IN_URL.exec(url)?.[1] ?? null
}

/**
 * Images whose file has a public address (asset id → url) stay images showing that address;
 * the rest become links, because monday's own file URLs need a monday login to load.
 */
export function mondayImagesAsLinks(
  html: string,
  imageLabel: string,
  imageUrls: ReadonlyMap<string, string> = new Map()
): string {
  // DOMParser documents are inert: nothing in them loads or runs.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const assetId = mondayAssetIdOf(image)
    const url = assetId ? imageUrls.get(assetId) : undefined
    if (url) {
      const shown = doc.createElement('img')
      shown.setAttribute('src', url)
      shown.setAttribute('alt', image.getAttribute('alt') ?? '')
      image.replaceWith(shown)
      continue
    }
    const link = doc.createElement('a')
    link.setAttribute('href', image.getAttribute('src') ?? '')
    link.textContent = imageLabel
    image.replaceWith(link)
  }
  return doc.body.innerHTML
}

/** Asset ids the update body already shows as images. */
export function mondayInlineImageAssetIds(
  html: string,
  imageUrls: ReadonlyMap<string, string>
): Set<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return new Set(
    Array.from(doc.querySelectorAll('img'))
      .map(mondayAssetIdOf)
      .filter((id): id is string => id !== null && imageUrls.has(id))
  )
}

let allowedImageSources: ReadonlySet<string> = new Set()
let purifier: ReturnType<typeof DOMPurify> | null = null

// Own instance, so its hook never touches other sanitizers in the app.
function mondayPurifier(): ReturnType<typeof DOMPurify> {
  if (!purifier) {
    purifier = DOMPurify(window)
    purifier.addHook('afterSanitizeAttributes', (node) => {
      // Only files monday handed Orca may load; any other image in the body stays unloaded.
      if (node.tagName === 'IMG' && !allowedImageSources.has(node.getAttribute('src') ?? '')) {
        node.removeAttribute('src')
      }
    })
  }
  return purifier
}

/**
 * monday update bodies are HTML written by other people. Keep only text formatting, http(s)
 * links, and images of the update's own files.
 */
export function sanitizeMondayHtml(
  html: string,
  imageLabel: string,
  imageUrls: ReadonlyMap<string, string> = new Map()
): string {
  allowedImageSources = new Set(imageUrls.values())
  try {
    return mondayPurifier().sanitize(mondayImagesAsLinks(html, imageLabel, imageUrls), {
      ALLOWED_TAGS: [...ALLOWED_TAGS, 'img'],
      ALLOWED_ATTR: ['href', 'src', 'alt'],
      ALLOWED_URI_REGEXP: /^https?:/i
    })
  } finally {
    allowedImageSources = new Set()
  }
}

const TEXT_BLOCK_TAGS = new Set([
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'TABLE',
  'TR',
  'UL'
])
const HTTP_HREF = /^https?:\/\//i
// Their text is code or markup, never something the update says.
const NON_TEXT_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'])

function endLine(out: string[]): void {
  const last = out.at(-1)
  if (last !== undefined && !last.endsWith('\n')) {
    out.push('\n')
  }
}

function appendNodeText(node: Node, imageLabel: string, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.textContent) {
      out.push(node.textContent)
    }
    return
  }
  if (!(node instanceof Element)) {
    return
  }
  const tag = node.tagName
  if (NON_TEXT_TAGS.has(tag)) {
    return
  }
  if (tag === 'BR') {
    out.push('\n')
    return
  }
  if (tag === 'IMG') {
    endLine(out)
    out.push(`${imageLabel} ${node.getAttribute('src') ?? ''}`.trim(), '\n')
    return
  }
  // Why endLine: monday writes one <p> per line, so a block only starts a line, never a blank one.
  const isBlock = TEXT_BLOCK_TAGS.has(tag)
  if (isBlock) {
    endLine(out)
  }
  if (tag === 'LI') {
    out.push('- ')
  }
  const href = tag === 'A' ? (node.getAttribute('href') ?? '') : ''
  const text = (node.textContent ?? '').trim()
  // Why: monday shortens long link text with "…", so a URL-looking text is swapped for the full href.
  if (HTTP_HREF.test(href) && (!text || HTTP_HREF.test(text))) {
    out.push(href)
  } else {
    node.childNodes.forEach((child) => appendNodeText(child, imageLabel, out))
    // Mentions (@name) link to a monday profile, which tells the reader nothing.
    if (HTTP_HREF.test(href) && !text.startsWith('@')) {
      out.push(` (${href})`)
    }
  }
  if (isBlock) {
    endLine(out)
  }
}

/** Plain text of an update body, keeping the address behind every link and image. */
export function mondayHtmlToText(html: string, imageLabel: string): string {
  // DOMParser documents are inert: nothing in them loads or runs.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: string[] = []
  appendNodeText(doc.body, imageLabel, out)
  return out
    .join('')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The http(s) link a click inside sanitized update HTML landed on, if any. */
export function mondayLinkFromClick(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null
  }
  const href = target.closest('a')?.getAttribute('href') ?? ''
  return /^https?:\/\//i.test(href) ? href : null
}
