import { describe, expect, it } from 'vitest'
import {
  classifySyncInput,
  decideSyncPaneStatus,
  decideSyncTarget,
  looksLikeLoginPrompt,
  type SshSyncTargetFacts
} from './ssh-sync-decision'

const SENDABLE: SshSyncTargetFacts = {
  isOnScreen: true,
  isJoined: true,
  isExcluded: false,
  paneCount: 1,
  foreground: 'ssh',
  hasUnacceptedManualSsh: false,
  isFullScreen: false,
  isSourceFullScreen: false,
  cursorLine: 'deploy@web-1:~$ '
}

describe('decideSyncTarget', () => {
  it('sends to a joined pane running ssh, on screen', () => {
    expect(decideSyncTarget(SENDABLE)).toEqual({ send: true })
  })

  it.each([
    ['a local shell, where it would run on this computer', { foreground: 'zsh' }, 'notSsh'],
    ['a local program', { foreground: 'sleep' }, 'notSsh'],
    ['a foreground it cannot read', { foreground: null }, 'notSsh'],
    ['a host nobody agreed to', { isJoined: false }, 'notJoined'],
    ['a pane no longer on screen', { isOnScreen: false }, 'notOnScreen'],
    ['a pane the user excluded', { isExcluded: true }, 'excluded'],
    ['a split tab', { paneCount: 2 }, 'splitTab'],
    [
      'an ssh started by hand, which may be another host',
      { hasUnacceptedManualSsh: true },
      'manualSsh'
    ],
    [
      'a full-screen program when the source is a shell',
      { isFullScreen: true },
      'fullScreenMismatch'
    ],
    [
      'a shell when the source is a full-screen program',
      { isSourceFullScreen: true },
      'fullScreenMismatch'
    ],
    ['a password prompt', { cursorLine: "deploy@web-1's password: " }, 'passwordPrompt']
  ])('holds back from %s', (_label, overrides, reason) => {
    expect(decideSyncTarget({ ...SENDABLE, ...overrides })).toEqual({ send: false, reason })
  })

  it('allows two full-screen programs to stay in step', () => {
    expect(decideSyncTarget({ ...SENDABLE, isFullScreen: true, isSourceFullScreen: true })).toEqual(
      { send: true }
    )
  })

  it('names being off screen before anything else, since that needs no other reason', () => {
    expect(
      decideSyncTarget({ ...SENDABLE, isOnScreen: false, foreground: 'zsh', isJoined: false })
    ).toEqual({ send: false, reason: 'notOnScreen' })
  })

  it('treats a local shell as the reason even for a hand-started session', () => {
    expect(
      decideSyncTarget({ ...SENDABLE, foreground: 'zsh', hasUnacceptedManualSsh: true })
    ).toEqual({ send: false, reason: 'notSsh' })
  })
})

describe('looksLikeLoginPrompt', () => {
  it.each([
    "deploy@203.0.113.10's password: ",
    'Password:',
    '[sudo] password for deploy: ',
    '[sudo] password for deploy: ***',
    "Password for 'https://user@git.example.com': ",
    'Enter MFA code for arn:aws:iam::123456789012:mfa/deploy: ',
    'Kennwort: ',
    'Пароль: ',
    '비밀번호: ',
    'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
    "Please type 'yes', 'no' or the fingerprint: ",
    "Please type 'yes' or 'no': ",
    'Accept updated hostkeys? (yes/no): ',
    "Enter passphrase for key '/home/deploy/.ssh/id_ed25519': ",
    'Verification code: ',
    'Enter PIN for token: ',
    '密碼：',
    '请输入密码: '
  ])('recognizes %j', (line) => {
    expect(looksLikeLoginPrompt(line)).toBe(true)
  })

  it.each([
    'deploy@web-1:~$ ',
    'deploy@web-1:~$ cat password.txt',
    'scp /etc/passwd root@db2:',
    'rsync -a --delete compass/ deploy@web2:',
    'pin the version: done',
    ''
  ])('leaves %j alone', (line) => {
    expect(looksLikeLoginPrompt(line)).toBe(false)
  })
})

describe('decideSyncPaneStatus', () => {
  const facts = {
    decision: { send: true } as const,
    isFollowing: true,
    isHoldingText: false,
    isAnotherPaneMidLine: false,
    isSourceSending: true
  }

  it('says it gets input only when it does', () => {
    expect(decideSyncPaneStatus(facts)).toEqual({ send: true })
    expect(decideSyncPaneStatus({ ...facts, isSourceSending: false })).toEqual({
      send: false,
      reason: 'sourcePaused'
    })
  })

  it('shows the reason a key would be refused ahead of anything else', () => {
    const decision = { send: false, reason: 'notSsh' } as const

    expect(decideSyncPaneStatus({ ...facts, decision, isFollowing: false })).toEqual(decision)
  })

  it('tells a stopped pane how to come back, or what it is waiting for', () => {
    expect(decideSyncPaneStatus({ ...facts, isFollowing: false })).toEqual({
      send: false,
      reason: 'outOfStep'
    })
    expect(
      decideSyncPaneStatus({ ...facts, isFollowing: false, isAnotherPaneMidLine: true })
    ).toEqual({ send: false, reason: 'waitingForLine' })
  })

  it('asks a pane at a real prompt to answer it', () => {
    const decision = { send: false, reason: 'passwordPrompt' } as const

    expect(decideSyncPaneStatus({ ...facts, decision, isFollowing: false })).toEqual(decision)
  })

  it('does not ask for an answer when the prompt is a cut-off command it holds', () => {
    const decision = { send: false, reason: 'passwordPrompt' } as const

    expect(
      decideSyncPaneStatus({ ...facts, decision, isFollowing: false, isHoldingText: true })
    ).toEqual({ send: false, reason: 'outOfStep' })
  })
})

describe('classifySyncInput', () => {
  it.each([
    ['a letter', 'a'],
    ['Enter', '\r'],
    ['Ctrl+C', '\u0003'],
    ['an arrow key', '\u001b[A'],
    ['text from an input method', '中文']
  ])('mirrors %s', (_label, data) => {
    expect(classifySyncInput(data, true)).toEqual({ kind: 'mirror', data })
  })

  it('ignores anything xterm did not mark as the user’s', () => {
    expect(classifySyncInput('a', false)).toEqual({ kind: 'ignore' })
  })

  it.each([
    ['a mouse report', '\u001b[<0;10;5M'],
    ['a focus report', '\u001b[I'],
    ['a cursor position reply', '\u001b[5;10R'],
    ['a device attributes reply', '\u001b[?1;2c']
  ])('ignores %s, even marked as user input', (_label, data) => {
    expect(classifySyncInput(data, true)).toEqual({ kind: 'ignore' })
  })

  it('keeps a pasted line to one pane if it would press Enter', () => {
    expect(classifySyncInput('rm -rf build\rdeploy\r', true)).toEqual({ kind: 'pasteStaysHere' })
    expect(classifySyncInput('\u001b[200~one\ntwo\u001b[201~', true)).toEqual({
      kind: 'pasteStaysHere'
    })
  })

  it('keeps a pasted control character to one pane too', () => {
    expect(classifySyncInput('a\u0003b', true)).toEqual({ kind: 'pasteStaysHere' })
    expect(classifySyncInput('\u001b[200~a\u0003b\u001b[201~', true)).toEqual({
      kind: 'pasteStaysHere'
    })
  })

  it('keeps a paste a program didn’t bracket to one pane, even one starting with ESC', () => {
    expect(classifySyncInput('\u001b[Arm -rf x\r', true)).toEqual({ kind: 'pasteStaysHere' })
  })

  it('mirrors keys that send several bytes, including Alt+Enter', () => {
    expect(classifySyncInput('\u001b\r', true)).toEqual({ kind: 'mirror', data: '\u001b\r' })
    expect(classifySyncInput('\u001bb', true)).toEqual({ kind: 'mirror', data: '\u001bb' })
  })

  it('mirrors a single pasted line without the paste markers', () => {
    expect(classifySyncInput('\u001b[200~uptime\u001b[201~', true)).toEqual({
      kind: 'mirror',
      data: 'uptime'
    })
  })
})
