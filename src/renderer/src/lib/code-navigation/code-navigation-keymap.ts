import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import type { KeybindingActionId } from '../../../../shared/keybindings'
import { codeEditorShortcutAction, setClaimingCodeEditor } from './code-editor-shortcut-claim'
import { codeNavigationHistory } from './code-navigation-history'
import { editorNavigationLocation } from './code-navigation-workspace'
import { openNavigationTarget } from './code-navigation-editor-opener'
import { installImplementationClick } from './code-navigation-implementation-click'
import type { CodeNavigationActivation } from './code-navigation-activation'
import type { CodeNavigationFeature } from '../../../../shared/code-navigation/code-navigation-types'

type CodeEditor = Monaco.editor.ICodeEditor

type MonacoAction = { command: string; feature?: CodeNavigationFeature }

const MONACO_ACTIONS: Partial<Record<KeybindingActionId, MonacoAction>> = {
  'editor.goToDeclaration': { command: 'editor.action.revealDefinition', feature: 'definition' },
  'editor.goToImplementation': {
    command: 'editor.action.goToImplementation',
    feature: 'implementation'
  },
  'editor.goToTypeDeclaration': {
    command: 'editor.action.goToTypeDefinition',
    feature: 'typeDefinition'
  },
  'editor.findUsages': { command: 'editor.action.goToReferences', feature: 'references' },
  'editor.quickDocumentation': { command: 'editor.action.showHover' }
}

function locationOf(editor: CodeEditor) {
  return editorNavigationLocation(useAppStore.getState(), editor)
}

function navigate(editor: CodeEditor, direction: 'back' | 'forward'): void {
  const here = locationOf(editor)
  const target = here ? codeNavigationHistory.step(direction, here) : null
  if (!here || !target) {
    return
  }
  const position = { lineNumber: target.line, column: target.column }
  if (target.filePath === here.filePath) {
    editor.setPosition(position)
    editor.revealPositionInCenterIfOutsideViewport(position)
    return
  }
  openNavigationTarget(target, target.filePath, position)
}

function runAction(
  editor: CodeEditor,
  actionId: KeybindingActionId,
  activation: CodeNavigationActivation
): void {
  if (actionId === 'editor.navigateBack' || actionId === 'editor.navigateForward') {
    navigate(editor, actionId === 'editor.navigateBack' ? 'back' : 'forward')
    return
  }
  const monacoAction = MONACO_ACTIONS[actionId]
  if (monacoAction) {
    if (monacoAction.feature) {
      activation.arm(editor, monacoAction.feature)
    }
    editor.trigger('keyboard', monacoAction.command, null)
  }
}

/**
 * JetBrains-style navigation keys for editor tabs (Cmd/Ctrl+B, Cmd/Ctrl+[ …). A window capture
 * listener runs before Monaco's own bindings, so Cmd+[ navigates instead of outdenting; main is
 * told which editor has focus so it stops treating Cmd/Ctrl+B as the sidebar toggle there.
 */
export function installCodeNavigationKeymap(
  monaco: Pick<typeof Monaco, 'editor'>,
  activation: CodeNavigationActivation
): () => void {
  let focused: CodeEditor | null = null
  const setFocused = (editor: CodeEditor | null): void => {
    if ((focused === null) !== (editor === null)) {
      window.api?.codeNavigation?.setCodeEditorFocused(editor !== null)
    }
    focused = editor
    setClaimingCodeEditor(editor)
  }
  const note = (editor: CodeEditor): void => {
    const location = locationOf(editor)
    if (location) {
      codeNavigationHistory.noteLocation(location)
    }
  }
  const claim = (editor: CodeEditor): void => {
    // Why tabs only: other Monaco surfaces (diff, SQL console) keep the app's own chords.
    if (locationOf(editor)) {
      setFocused(editor)
      note(editor)
    } else if (focused === editor) {
      setFocused(null)
    }
  }
  const release = (editor: CodeEditor): void => {
    if (focused === editor) {
      setFocused(null)
    }
  }

  const created = monaco.editor.onDidCreateEditor((editor) => {
    editor.onDidFocusEditorText(() => claim(editor))
    editor.onDidBlurEditorText(() => release(editor))
    editor.onDidChangeModel(() => {
      if (editor.hasTextFocus()) {
        claim(editor)
      }
    })
    editor.onDidChangeCursorPosition(() => {
      if (focused === editor) {
        note(editor)
      }
    })
    const removeImplementationClick = installImplementationClick(
      editor,
      () => locationOf(editor) !== null,
      () => activation.arm(editor, 'implementation')
    )
    editor.onDidDispose(() => {
      removeImplementationClick()
      release(editor)
    })
  })

  const onKeyDown = (event: KeyboardEvent): void => {
    const editor = focused
    const actionId = codeEditorShortcutAction(event)
    if (!editor || !actionId) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    // Why: holding a jump key must not stack jumps; held Back/Forward keeps stepping like JetBrains.
    if (
      event.repeat &&
      actionId !== 'editor.navigateBack' &&
      actionId !== 'editor.navigateForward'
    ) {
      return
    }
    runAction(editor, actionId, activation)
  }
  window.addEventListener('keydown', onKeyDown, true)

  return () => {
    created.dispose()
    window.removeEventListener('keydown', onKeyDown, true)
    setFocused(null)
  }
}
