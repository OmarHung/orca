import { describe, expect, it, vi } from 'vitest'

import { pasteTerminalClipboard } from './terminal-clipboard-paste'
import {
  markTerminalBracketedPasteInterrupted,
  pasteTerminalText
} from '../input/paste/terminal-bracketed-paste'

describe('terminal clipboard paste', () => {
  it('forces generated image paste onto the native bracketed-paste path after Ctrl+C', async () => {
    const observedIgnoreBracketedPasteMode: boolean[] = []
    const terminal = {
      modes: { bracketedPasteMode: true },
      options: { ignoreBracketedPasteMode: false },
      input: vi.fn(() => {
        observedIgnoreBracketedPasteMode.push(terminal.options.ignoreBracketedPasteMode)
      }),
      paste: vi.fn(() => {
        observedIgnoreBracketedPasteMode.push(terminal.options.ignoreBracketedPasteMode)
      })
    }
    markTerminalBracketedPasteInterrupted(terminal)

    await pasteTerminalClipboard({
      readClipboardText: vi.fn().mockResolvedValue(''),
      saveClipboardImageAsTempFile: vi
        .fn()
        .mockResolvedValue('/tmp/orca-paste-1760000000000-id.png'),
      pasteText: (text, options) => pasteTerminalText(terminal, text, options)
    })

    expect(terminal.input).toHaveBeenCalledWith(
      '\x1b[200~/tmp/orca-paste-1760000000000-id.png\x1b[201~'
    )
    expect(terminal.paste).not.toHaveBeenCalled()
    expect(observedIgnoreBracketedPasteMode).toEqual([false])
    expect(terminal.options.ignoreBracketedPasteMode).toBe(false)
  })

  it('hands the pasted image path to the caller once it reached the terminal', async () => {
    const onImagePasted = vi.fn()
    const result = await pasteTerminalClipboard({
      readClipboardText: vi.fn().mockResolvedValue(''),
      saveClipboardImageAsTempFile: vi
        .fn()
        .mockResolvedValue('/tmp/orca-paste-1760000000000-id.png'),
      pasteText: vi.fn().mockResolvedValue(true),
      onImagePasted
    })

    expect(onImagePasted).toHaveBeenCalledWith('/tmp/orca-paste-1760000000000-id.png')
    expect(result).toEqual({ status: 'pasted', kind: 'image-path' })
  })
})
