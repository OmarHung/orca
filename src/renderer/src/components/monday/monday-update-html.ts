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

/** The http(s) link a click inside sanitized update HTML landed on, if any. */
export function mondayLinkFromClick(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null
  }
  const href = target.closest('a')?.getAttribute('href') ?? ''
  return /^https?:\/\//i.test(href) ? href : null
}
