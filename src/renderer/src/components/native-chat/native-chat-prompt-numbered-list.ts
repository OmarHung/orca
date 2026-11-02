import { Extension, type Editor } from '@tiptap/react'
import { promptText } from './native-chat-prompt-document'

// Indent, number and the spacing after its dot; nine digits stay exact once parsed.
const NUMBERED_ITEM = /^([ \t]*)(\d{1,9})\.([ \t]+)/

function continueNumberedItem(editor: Editor): boolean {
  const { doc, selection } = editor.state
  const { $from, empty } = selection
  if (!empty) {
    return false
  }
  // A hard break also starts a line, so a paragraph can hold several items.
  const lineBefore = promptText(doc, $from.start(), $from.pos).split('\n').at(-1) ?? ''
  const item = NUMBERED_ITEM.exec(lineBefore)
  if (!item) {
    return false
  }
  const [marker, indent, number, spacing] = item
  const lineAfter = promptText(doc, $from.pos, $from.end()).split('\n', 1)[0]
  if (lineBefore === marker && lineAfter === '') {
    const from = $from.pos - marker.length
    const previousLine = promptText(doc, 0, from).split('\n').at(-2) ?? ''
    const cleared = editor.chain().deleteRange({ from, to: $from.pos })
    // Without a blank line, Markdown folds the next line into the list's last item.
    return (NUMBERED_ITEM.test(previousLine) ? cleared.splitBlock() : cleared).run()
  }
  const next = String(Number(number) + 1).padStart(number.length, '0')
  return editor
    .chain()
    .splitBlock()
    .command(({ tr }) => {
      tr.insertText(`${indent}${next}.${spacing}`)
      return true
    })
    .run()
}

/** Enter continues a typed `1. ` line, as a Markdown editor does; the prompt stays plain text. */
export const NativeChatNumberedList = Extension.create({
  name: 'nativeChatNumberedList',
  // Runs before the default Enter, which would only split the line.
  priority: 1000,
  addKeyboardShortcuts() {
    return { Enter: () => continueNumberedItem(this.editor) }
  }
})
