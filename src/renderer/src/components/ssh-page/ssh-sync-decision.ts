import { hasSshCommandControlCharacter } from '../../../../shared/ssh-command-types'
import { isTerminalQueryReply } from '../../../../shared/terminal/protocol/queries/terminal-query-reply'
import { isPassiveTerminalInputReport } from '../terminal-pane/terminal-passive-input-report'
import { isXtermMouseReport } from '../terminal-pane/terminal-pointer-input-sequences'
import { isSshProcess } from './ssh-session-liveness'

export type SshSyncSkipReason =
  | 'notOnScreen'
  | 'notJoined'
  | 'excluded'
  | 'splitTab'
  | 'notSsh'
  | 'manualSsh'
  | 'fullScreenMismatch'
  | 'passwordPrompt'
  /** This pane missed part of a line or holds its own, and takes nothing until the user clears it. */
  | 'outOfStep'
  /** Same, and the others are part way through a line, which it can't come in on. */
  | 'waitingForLine'
  /** The pane in use isn't sending right now, so nothing is coming. */
  | 'sourcePaused'
  | 'writeFailed'

export type SshSyncTargetFacts = {
  /** In the grid on screen. Input never goes anywhere the user can't see it land. */
  isOnScreen: boolean
  /** The user agreed to this host receiving input. */
  isJoined: boolean
  isExcluded: boolean
  /** Panes in the tab; a split leaves it unclear which one should get the keys. */
  paneCount: number
  /** Null when it couldn't be read, which proves nothing. */
  foreground: string | null
  /** ssh came back without Orca being asked and the user hasn't accepted it, so it may be another host. */
  hasUnacceptedManualSsh: boolean
  isFullScreen: boolean
  isSourceFullScreen: boolean
  cursorLine: string
}

export type SshSyncDecision = { send: true } | { send: false; reason: SshSyncSkipReason }

const SECRET_PROMPT =
  /(\bpass(word|phrase|code)?\b|\bpin\b|verification code|one-time|\botp\b|\bmfa\b|\b2fa\b|\btoken\b|kennwort|contraseña|mot de passe|senha|пароль|密碼|密码|口令|暗号|パスワード|비밀번호).*[:：]\s*\**\s*$/i
const HOST_KEY_PROMPT = /\(yes\/no(\/\[fingerprint\])?\)[?:]\s*$|please type 'yes'.*:\s*$/i

/** Best effort, by matching text: a prompt worded differently will not be caught. */
export function looksLikeLoginPrompt(line: string): boolean {
  return SECRET_PROMPT.test(line) || HOST_KEY_PROMPT.test(line)
}

/** Whether one keystroke goes to one pane. Anything unproven stays home: ssh in front above all. */
export function decideSyncTarget(facts: SshSyncTargetFacts): SshSyncDecision {
  if (!facts.isOnScreen) {
    return { send: false, reason: 'notOnScreen' }
  }
  if (!facts.isJoined) {
    return { send: false, reason: 'notJoined' }
  }
  if (facts.isExcluded) {
    return { send: false, reason: 'excluded' }
  }
  if (facts.paneCount !== 1) {
    return { send: false, reason: 'splitTab' }
  }
  // Why first of the live checks: anywhere else, the keystrokes run on the user's own computer.
  if (facts.foreground === null || !isSshProcess(facts.foreground)) {
    return { send: false, reason: 'notSsh' }
  }
  if (facts.hasUnacceptedManualSsh) {
    return { send: false, reason: 'manualSsh' }
  }
  // Why: a shell's letters would be editing commands in vim, and vim's would run in a shell.
  if (facts.isFullScreen !== facts.isSourceFullScreen) {
    return { send: false, reason: 'fullScreenMismatch' }
  }
  if (looksLikeLoginPrompt(facts.cursorLine)) {
    return { send: false, reason: 'passwordPrompt' }
  }
  return { send: true }
}

/** What a pane's title says, which is what the user acts on, given what each key would do. */
export function decideSyncPaneStatus(facts: {
  decision: SshSyncDecision
  isFollowing: boolean
  isHoldingText: boolean
  isAnotherPaneMidLine: boolean
  isSourceSending: boolean
}): SshSyncDecision {
  const { decision, isFollowing } = facts
  // Why: text it holds can look like a prompt, and "answering" that would run a cut-off command.
  const isTextNotPrompt =
    !decision.send && decision.reason === 'passwordPrompt' && !isFollowing && facts.isHoldingText
  if (!decision.send && !isTextNotPrompt) {
    return decision
  }
  if (!isFollowing) {
    return { send: false, reason: facts.isAnotherPaneMidLine ? 'waitingForLine' : 'outOfStep' }
  }
  return facts.isSourceSending ? decision : { send: false, reason: 'sourcePaused' }
}

export type SshSyncInput =
  | { kind: 'mirror'; data: string }
  | { kind: 'ignore' }
  /** A pasted line break or control would act on every host, so it only reaches this pane. */
  | { kind: 'pasteStaysHere' }

const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

/** What a terminal's input means for the other panes: only what the person typed or pasted. */
export function classifySyncInput(data: string, wasUserInput: boolean): SshSyncInput {
  // Why: without xterm's private signal this is always false, so unknown origin stays home.
  if (
    !wasUserInput ||
    isTerminalQueryReply(data) ||
    isXtermMouseReport(data) ||
    isPassiveTerminalInputReport(data)
  ) {
    return { kind: 'ignore' }
  }
  if (data.startsWith(BRACKETED_PASTE_START) && data.endsWith(BRACKETED_PASTE_END)) {
    const pasted = data.slice(BRACKETED_PASTE_START.length, -BRACKETED_PASTE_END.length)
    // Why unwrap: another host's program may not have asked for bracketed paste, and would print it.
    return hasSshCommandControlCharacter(pasted)
      ? { kind: 'pasteStaysHere' }
      : { kind: 'mirror', data: pasted }
  }
  // Why: more than one character with a control in it is a paste, not a key. Keys that send several
  // bytes start with ESC and have none after it, except Alt with a control key.
  const isAltKey = data.length === 2 && data.startsWith('\x1b')
  const rest = data.startsWith('\x1b') ? data.slice(1) : data
  return data.length > 1 && !isAltKey && hasSshCommandControlCharacter(rest)
    ? { kind: 'pasteStaysHere' }
    : { kind: 'mirror', data }
}
