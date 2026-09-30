import type { KeybindingActionId, KeybindingDefinition } from './types'
import { platformBindings } from './definitions-support'

const keywords = (...words: string[]): string[] => ['shortcut', 'editor', 'jetbrains', ...words]

/**
 * JetBrains-style code navigation (fork). Editor-scoped: while a code editor has focus these win
 * over same-chord app actions (Mod+B sidebar, Mod+Shift+B browser tab), which main lets through.
 */
export const KEYBINDING_DEFINITION_CODE_NAVIGATION: readonly KeybindingDefinition[] = [
  {
    id: 'editor.goToDeclaration',
    title: 'Go to Declaration',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('definition', 'declaration', 'navigate'),
    defaultBindings: platformBindings(['Mod+B'])
  },
  {
    id: 'editor.goToImplementation',
    title: 'Go to Implementation',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('implementation', 'navigate'),
    defaultBindings: platformBindings(['Mod+Alt+B'])
  },
  {
    id: 'editor.goToTypeDeclaration',
    title: 'Go to Type Declaration',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('type', 'definition', 'declaration', 'navigate'),
    defaultBindings: platformBindings(['Mod+Shift+B'])
  },
  {
    id: 'editor.findUsages',
    title: 'Find Usages',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('usages', 'references', 'find'),
    defaultBindings: platformBindings(['Alt+F7'])
  },
  {
    id: 'editor.quickDocumentation',
    title: 'Quick Documentation',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('documentation', 'hover', 'docs'),
    // Why macOS only: JetBrains' Ctrl+Q elsewhere is the native Quit accelerator.
    defaultBindings: { darwin: ['F1'], linux: [], win32: [] },
    allowBareKeybindings: true
  },
  {
    id: 'editor.navigateBack',
    title: 'Navigate Back',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('back', 'history', 'previous', 'location'),
    defaultBindings: {
      darwin: ['Mod+BracketLeft'],
      linux: ['Mod+Alt+ArrowLeft'],
      win32: ['Mod+Alt+ArrowLeft']
    }
  },
  {
    id: 'editor.navigateForward',
    title: 'Navigate Forward',
    group: 'Editors',
    scope: 'editor',
    searchKeywords: keywords('forward', 'history', 'next', 'location'),
    defaultBindings: {
      darwin: ['Mod+BracketRight'],
      linux: ['Mod+Alt+ArrowRight'],
      win32: ['Mod+Alt+ArrowRight']
    }
  }
]

export const CODE_NAVIGATION_KEYBINDING_ACTION_IDS: readonly KeybindingActionId[] =
  KEYBINDING_DEFINITION_CODE_NAVIGATION.map((definition) => definition.id)
