import { describe, expect, it } from 'vitest'
import { readPyprojectTables } from './pyproject-tables'

describe('readPyprojectTables', () => {
  it('reads single-line string keys per table, including quoted keys and comments', () => {
    const tables = readPyprojectTables(
      [
        '[project]',
        'name = "shop"  # the dist name',
        'version = "1.0"',
        'dependencies = [',
        '  "django>=5",',
        ']',
        '',
        '[project.scripts]',
        "serve = 'shop.cli:serve'",
        '"shop-admin" = "shop.admin:main"',
        '',
        '[ tool . "poetry" ]',
        'name = "shop-poetry"',
        '[tool.pytest.ini_options]',
        'addopts = "-q"'
      ].join('\n')
    )

    expect(tables.get('project')?.get('name')).toBe('shop')
    expect([...(tables.get('project.scripts') ?? [])]).toEqual([
      ['serve', 'shop.cli:serve'],
      ['shop-admin', 'shop.admin:main']
    ])
    expect(tables.get('tool.poetry')?.get('name')).toBe('shop-poetry')
    expect(tables.has('tool.pytest.ini_options')).toBe(true)
  })

  it('ignores multi-line strings and array tables', () => {
    const tables = readPyprojectTables(
      [
        '[project]',
        'description = """',
        '[project.scripts]',
        'fake = "x:y"',
        '"""',
        'name = "real"',
        '[[tool.hatch.envs]]',
        'name = "not-a-project"'
      ].join('\n')
    )

    expect(tables.has('project.scripts')).toBe(false)
    expect(tables.get('project')?.get('name')).toBe('real')
  })
})
