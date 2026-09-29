import { describe, expect, it } from 'vitest'
import { quoteShellArgument } from './run-configuration-types'

describe('quoteShellArgument', () => {
  it.each(['dev', 'src/index.js', 'build:prod', 'Api.csproj', 'a+b=c'])(
    'leaves %s unquoted',
    (value) => {
      expect(quoteShellArgument(value)).toBe(value)
    }
  )

  it.each([
    ['My App', '"My App"'],
    ['src\\Api\\Api.csproj', '"src\\Api\\Api.csproj"'],
    ["it's", '"it\'s"'],
    ['a&b;c|d<e>f', '"a&b;c|d<e>f"'],
    ['(x) {y} [z]', '"(x) {y} [z]"'],
    // Why quoted: @x splats a variable and a,b builds an array in PowerShell.
    ['@scope/pkg', '"@scope/pkg"'],
    ['a,b', '"a,b"'],
    ['', '""']
  ])('double-quotes %s', (value, quoted) => {
    expect(quoteShellArgument(value)).toBe(quoted)
  })

  it.each([
    ['POSIX command substitution', '$(touch pwned)'],
    ['backtick substitution', '`touch pwned`'],
    ['a variable', '${HOME}'],
    ['a cmd variable', '%PATH%'],
    ['history or delayed expansion', 'a!b'],
    ['a double quote', 'a" & calc & "'],
    ['a PowerShell smart quote', '“x”; calc'],
    ['a low smart quote', '„x'],
    ['a trailing backslash', 'out\\'],
    ['a doubled backslash', '\\\\server\\share'],
    ['a line break', 'a\nb'],
    ['a carriage return', 'a\rb'],
    ['a control character', 'a\u0003b'],
    ['an escape sequence', 'a\u001b[31m'],
    ['a C1 control', 'a\u009bb']
  ])('refuses a value with %s', (_case, value) => {
    expect(quoteShellArgument(value)).toBeNull()
  })
})
