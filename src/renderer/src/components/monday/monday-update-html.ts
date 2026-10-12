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

export function mondayImagesAsLinks(html: string, imageLabel: string): string {
  // DOMParser documents are inert: nothing in them loads or runs.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const link = doc.createElement('a')
    link.setAttribute('href', image.getAttribute('src') ?? '')
    link.textContent = imageLabel
    image.replaceWith(link)
  }
  return doc.body.innerHTML
}

/**
 * monday update bodies are HTML written by other people. Keep only text formatting and http(s)
 * links; images become links because monday's file URLs need a monday login to load.
 */
export function sanitizeMondayHtml(html: string, imageLabel: string): string {
  return DOMPurify.sanitize(mondayImagesAsLinks(html, imageLabel), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href'],
    ALLOWED_URI_REGEXP: /^https?:/i
  })
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
