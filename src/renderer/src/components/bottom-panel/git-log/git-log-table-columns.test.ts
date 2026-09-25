// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildGitLogGridTemplate, measureGitLogColumnContentWidth } from './git-log-table-columns'

function withSize(
  element: HTMLElement,
  scrollWidth: number,
  clientWidth = scrollWidth
): HTMLElement {
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth })
  Object.defineProperty(element, 'clientWidth', { value: clientWidth })
  return element
}

function cell(column: string, scrollWidth: number): HTMLElement {
  const element = document.createElement('span')
  element.setAttribute('data-git-log-col', column)
  return withSize(element, scrollWidth)
}

describe('git log table columns', () => {
  it('gives every column, Subject included, a fixed pixel width like Excel', () => {
    expect(buildGitLogGridTemplate({ subject: 400, author: 120, date: 90, hash: 70 })).toBe(
      '400px 120px 90px 70px'
    )
  })

  it('auto-fits to the widest cell in that column only, header included', () => {
    const table = document.createElement('div')
    table.append(cell('author', 42), cell('author', 97.2), cell('date', 300), cell('author', 60))
    expect(measureGitLogColumnContentWidth(table, 'author')).toBe(98 + 4)
  })

  it('adds back the hidden overflow of a truncated text inside a composite cell', () => {
    const subject = cell('subject', 300)
    const text = withSize(document.createElement('span'), 260, 180)
    text.setAttribute('data-git-log-text', '')
    subject.append(text)
    const table = document.createElement('div')
    table.append(subject)
    // 300 visible + 80 clipped message text + slack
    expect(measureGitLogColumnContentWidth(table, 'subject')).toBe(384)
  })

  it('returns only the slack for an empty column', () => {
    expect(measureGitLogColumnContentWidth(document.createElement('div'), 'hash')).toBe(4)
  })
})
