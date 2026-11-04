import { describe, expect, it } from 'vitest'
import {
  expandSshCommandTemplate,
  extractSshCommandKeys,
  findQuotedSshCommandKeys,
  literalBraceTokens,
  syncSshCommandParams,
  type SshCommandExpansionInput
} from './ssh-command-template'
import type { SshCommandParam } from './ssh-command-types'

function param(key: string, overrides: Partial<SshCommandParam> = {}): SshCommandParam {
  return {
    key,
    label: key,
    kind: 'text',
    defaultValue: '',
    required: true,
    quote: 'shell',
    ...overrides
  }
}

function expand(
  overrides: Partial<SshCommandExpansionInput>
): ReturnType<typeof expandSshCommandTemplate> {
  return expandSshCommandTemplate({
    template: 'echo {{value}}',
    params: [param('value')],
    values: {},
    builtins: { host: 'web-1', user: 'deploy', path: null, selected: [] },
    ...overrides
  })
}

describe('extractSshCommandKeys', () => {
  it('lists each parameter once, in the order written', () => {
    expect(extractSshCommandKeys('a {{b}} {{a-1}} {{b}} {{c_2}}')).toEqual(['b', 'a-1', 'c_2'])
  })

  it('leaves other double braces alone, so docker and go templates keep working', () => {
    const template = "docker ps --format '{{.Names}} {{json .}}' {{ spaced }}"

    expect(extractSshCommandKeys(template)).toEqual([])
    expect(literalBraceTokens(template)).toEqual(['{{.Names}}', '{{json .}}', '{{ spaced }}'])
  })
})

describe('findQuotedSshCommandKeys', () => {
  it('flags a parameter written inside quotes, where a second layer of quotes would break it', () => {
    expect(findQuotedSshCommandKeys(`grep "{{a}}" '{{b}}' {{c}} 'x' {{d}}`)).toEqual(['a', 'b'])
  })

  it('is not fooled by an escaped quote', () => {
    expect(findQuotedSshCommandKeys('echo "\\"{{a}}"')).toEqual(['a'])
    expect(findQuotedSshCommandKeys("echo $'\\'{{b}}'")).toEqual(['b'])
    expect(findQuotedSshCommandKeys('echo \\" {{c}}')).toEqual([])
  })

  it('knows a backslash means nothing inside single quotes', () => {
    expect(findQuotedSshCommandKeys("echo 'a\\' {{a}}")).toEqual([])
  })
})

describe('syncSshCommandParams', () => {
  it('adds a row for a new parameter with safe defaults', () => {
    const { params } = syncSshCommandParams('ls {{dir}}', [])

    expect(params).toEqual([param('dir', { label: 'dir' })])
  })

  it('follows the template order and keeps what was already filled in', () => {
    const existing = [param('b', { label: 'Second' }), param('a', { label: 'First' })]

    const { params } = syncSshCommandParams('{{a}} {{b}}', existing)

    expect(params.map((row) => row.label)).toEqual(['First', 'Second'])
  })

  it('keeps a parameter removed from the template as unused, until it is deleted', () => {
    const { params, unusedKeys } = syncSshCommandParams('ls', [param('old', { label: 'Kept' })])

    expect(params.map((row) => row.label)).toEqual(['Kept'])
    expect(unusedKeys).toEqual(['old'])
  })

  it('drops a row nobody filled in, so retyping a name leaves no trail', () => {
    const { params, unusedKeys } = syncSshCommandParams('ls {{service}}', [param('servic')])

    expect(params.map((row) => row.key)).toEqual(['service'])
    expect(unusedKeys).toEqual([])
  })

  it('gives built-in values no row, since the user never fills them in', () => {
    const { params } = syncSshCommandParams('{{host}} {{user}} {{path}} {{selected}}', [])

    expect(params).toEqual([])
  })
})

describe('expandSshCommandTemplate', () => {
  it('leaves a plain value as it is', () => {
    const result = expand({ values: { value: 'nginx.service' } })

    expect(result.command).toBe('echo nginx.service')
    expect(result.problems).toEqual([])
  })

  it('keeps a hostile value as one string', () => {
    const result = expand({ values: { value: 'nginx; rm -rf /' } })

    expect(result.command).toBe("echo 'nginx; rm -rf /'")
  })

  it('cannot be broken out of with a quote, a substitution or a backtick', () => {
    expect(expand({ values: { value: "a'; touch x; '" } }).command).toBe(
      `echo 'a'\\''; touch x; '\\'''`
    )
    expect(expand({ values: { value: '$(touch x)' } }).command).toBe("echo '$(touch x)'")
    expect(expand({ values: { value: '`touch x`' } }).command).toBe("echo '`touch x`'")
  })

  it('does not expand parameters a value brings in', () => {
    const result = expand({
      template: 'echo {{a}} {{b}}',
      params: [param('a'), param('b')],
      values: { a: '{{b}}', b: 'real' }
    })

    expect(result.command).toBe("echo '{{b}}' real")
  })

  it('leaves literal double braces in the template untouched', () => {
    const result = expand({
      template: "docker ps --format '{{.Names}}' {{value}}",
      values: { value: 'x' }
    })

    expect(result.command).toBe("docker ps --format '{{.Names}}' x")
  })

  it.each([
    ['a newline, which would press Enter', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['an escape sequence', 'a\u001b[0m'],
    ['a tab', 'a\tb'],
    ['a C1 control', 'a\u009bb'],
    ['a delete', 'a\u007fb']
  ])('refuses %s', (_label, value) => {
    expect(expand({ values: { value } }).problems).toEqual([
      { kind: 'controlCharacter', key: 'value' }
    ])
  })

  it('refuses a control character in a raw value too', () => {
    const result = expand({ params: [param('value', { quote: 'raw' })], values: { value: 'a\nb' } })

    expect(result.problems).toEqual([{ kind: 'controlCharacter', key: 'value' }])
  })

  it('warns when a value starts with a dash, since quotes cannot stop an option', () => {
    const result = expand({ values: { value: '--force' } })

    expect(result.command).toBe('echo --force')
    expect(result.problems).toEqual([])
    expect(result.warnings).toEqual([{ kind: 'leadingDash', key: 'value' }])
  })

  it('inserts a raw value as written, and says so', () => {
    const result = expand({
      params: [param('value', { quote: 'raw' })],
      values: { value: '-a -b "c d"' }
    })

    expect(result.command).toBe('echo -a -b "c d"')
    expect(result.warnings).toContainEqual({ kind: 'rawValue', key: 'value' })
  })

  it('needs a required value', () => {
    expect(expand({ values: { value: '' } }).problems).toEqual([
      { kind: 'missingValue', key: 'value' }
    ])
  })

  it('refuses a value inside quotes in the template, where it could close them', () => {
    const result = expand({
      template: 'grep "{{value}}" f',
      values: { value: 'a"; touch pwned; "' }
    })

    expect(result.problems).toEqual([{ kind: 'insideQuotes', key: 'value' }])
  })

  it('refuses a built-in value inside quotes, since a remote file name could close them', () => {
    const result = expand({
      template: 'cat "{{selected}}"',
      params: [],
      builtins: { host: 'h', user: 'u', path: '/srv', selected: ['/srv/a"; touch pwned; "'] }
    })

    expect(result.problems).toEqual([{ kind: 'insideQuotes', key: 'selected' }])
  })

  it('allows a raw value inside quotes, which the author chose to handle', () => {
    const result = expand({
      template: 'grep "{{value}}" f',
      params: [param('value', { quote: 'raw' })],
      values: { value: 'word' }
    })

    expect(result.command).toBe('grep "word" f')
    expect(result.problems).toEqual([])
  })

  it.each([
    [
      'a selected file name',
      'cat {{selected}}',
      { selected: ['x\u0015touch pwned\n'] },
      'selected'
    ],
    ['the folder', 'ls {{path}}', { path: '/srv/x\ntouch pwned' }, 'path'],
    ['the user', 'echo {{user}}', { user: 'a\u001b[0m' }, 'user']
  ])(
    'refuses a control character in %s, which comes from the server',
    (_label, template, builtins, key) => {
      const result = expand({
        template,
        params: [],
        builtins: { host: 'h', user: 'u', path: '/srv', selected: ['/srv/a'], ...builtins }
      })

      expect(result.problems).toEqual([{ kind: 'controlCharacter', key }])
    }
  )

  it.each([
    ['a right-to-left override', 'a\u202eb'],
    ['a directional isolate', 'a\u2066b'],
    ['a line separator', 'a\u2028b']
  ])('refuses %s, which could make the preview read differently', (_label, value) => {
    expect(expand({ values: { value } }).problems).toEqual([
      { kind: 'controlCharacter', key: 'value' }
    ])
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'treats %s as an ordinary parameter name',
    (key) => {
      const result = expand({
        template: `echo {{${key}}}`,
        params: [param(key, { defaultValue: 'plain' })],
        values: {}
      })

      expect(result.command).toBe('echo plain')
    }
  )

  it('warns once about a value used twice', () => {
    const result = expand({ template: 'echo {{value}} {{value}}', values: { value: '-x' } })

    expect(result.warnings).toEqual([{ kind: 'leadingDash', key: 'value' }])
  })

  it('leaves an empty optional value out, instead of passing an empty argument', () => {
    const result = expand({ params: [param('value', { required: false })], values: {} })

    expect(result.command).toBe('echo ')
    expect(result.problems).toEqual([])
  })

  it('falls back to the default value when nothing was typed', () => {
    const result = expand({ params: [param('value', { defaultValue: 'nginx' })], values: {} })

    expect(result.command).toBe('echo nginx')
  })

  it('accepts only numbers for a number parameter', () => {
    const params = [param('value', { kind: 'number' })]

    expect(expand({ params, values: { value: '100' } }).command).toBe('echo 100')
    expect(expand({ params, values: { value: '1; rm' } }).problems).toEqual([
      { kind: 'notANumber', key: 'value' }
    ])
  })

  it('accepts only a listed option for a select parameter', () => {
    const params = [param('value', { kind: 'select', options: ['a', 'b c'] })]

    expect(expand({ params, values: { value: 'b c' } }).command).toBe("echo 'b c'")
    expect(expand({ params, values: { value: 'z' } }).problems).toEqual([
      { kind: 'notAnOption', key: 'value' }
    ])
  })

  it('fills in the host and user of the target', () => {
    const result = expand({ template: 'ssh-keygen -R {{host}} # {{user}}', params: [] })

    expect(result.command).toBe('ssh-keygen -R web-1 # deploy')
  })

  it('quotes a folder with spaces', () => {
    const result = expand({
      template: 'ls {{path}}',
      params: [],
      builtins: { host: 'h', user: 'u', path: '/srv/my app', selected: [] }
    })

    expect(result.command).toBe("ls '/srv/my app'")
  })

  it('needs an open files pane for the folder', () => {
    const result = expand({ template: 'ls {{path}}', params: [] })

    expect(result.problems).toEqual([{ kind: 'noPath', key: 'path' }])
  })

  it('passes each selected item as its own argument', () => {
    const result = expand({
      template: 'rm {{selected}}',
      params: [],
      builtins: { host: 'h', user: 'u', path: '/srv', selected: ['/srv/a b', '/srv/c'] }
    })

    expect(result.command).toBe("rm '/srv/a b' /srv/c")
  })

  it('needs something selected', () => {
    const result = expand({ template: 'rm {{selected}}', params: [] })

    expect(result.problems).toEqual([{ kind: 'noSelection', key: 'selected' }])
  })

  it('flattens a multi-line template, so no line break presses Enter early', () => {
    const result = expand({ template: 'cd /srv\n\n  echo {{value}}\r\n', values: { value: 'x' } })

    expect(result.command).toBe('cd /srv; echo x')
  })

  it('keeps a continued line as one command', () => {
    const result = expand({
      template: 'docker run \\\n  --rm \\\n  {{value}}',
      values: { value: 'img' }
    })

    expect(result.command).toBe('docker run --rm img')
  })

  it('leaves out comment lines, which would swallow everything after them', () => {
    const result = expand({
      template: '# restart it\nsystemctl restart {{value}}',
      values: { value: 'x' }
    })

    expect(result.command).toBe('systemctl restart x')
  })

  it.each([
    ['&&', 'a &&\nb', 'a && b'],
    ['||', 'a ||\nb', 'a || b'],
    ['a pipe', 'a |\nb', 'a | b']
  ])('continues after %s instead of adding a semicolon', (_label, template, command) => {
    expect(expand({ template, params: [] }).command).toBe(command)
  })

  it.each(['path', 'selected'])(
    'refuses {{%s}} on several hosts, since it belongs to one tab',
    (key) => {
      const result = expand({
        template: `ls {{${key}}}`,
        params: [],
        isMultiTarget: true,
        builtins: { host: 'h', user: 'u', path: '/srv', selected: ['/srv/a'] }
      })

      expect(result.problems).toEqual([{ kind: 'singleTargetOnly', key }])
    }
  )

  it('still fills in the host and user on several hosts', () => {
    const result = expand({ template: 'echo {{host}} {{user}}', params: [], isMultiTarget: true })

    expect(result.command).toBe('echo web-1 deploy')
    expect(result.problems).toEqual([])
  })

  it('points at a parameter that has no definition', () => {
    const result = expand({ template: 'echo {{other}}', params: [] })

    expect(result.command).toBe('echo {{other}}')
    expect(result.problems).toEqual([{ kind: 'undefinedParam', key: 'other' }])
  })

  describe('on a Windows host, whose shells quote differently', () => {
    const windows = { remotePlatform: 'win32' as const }

    it('refuses to quote free text', () => {
      const result = expand({ ...windows, values: { value: 'a b' } })

      expect(result.problems).toEqual([{ kind: 'windowsNeedsRaw', key: 'value' }])
    })

    it('inserts a raw value as written', () => {
      const result = expand({
        ...windows,
        params: [param('value', { quote: 'raw' })],
        values: { value: '"a b"' }
      })

      expect(result.command).toBe('echo "a b"')
      expect(result.problems).toEqual([])
    })

    it('inserts a listed option as the author wrote it', () => {
      const result = expand({
        ...windows,
        params: [param('value', { kind: 'select', options: ['"a b"'] })],
        values: { value: '"a b"' }
      })

      expect(result.command).toBe('echo "a b"')
    })

    it('refuses a built-in value it could only pass safely if it were plain', () => {
      const result = expand({
        ...windows,
        template: 'dir {{path}}',
        params: [],
        builtins: { host: 'h', user: 'u', path: 'C:\\Program Files', selected: [] }
      })

      expect(result.problems).toEqual([{ kind: 'windowsNeedsRaw', key: 'path' }])
    })
  })
})
