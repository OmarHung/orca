import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DATABASE_DRIVERS } from '../../../../shared/database/database-connection-types'
import { DatabaseDriverIcon } from './database-driver-icon'

describe('DatabaseDriverIcon', () => {
  it('draws a different mark for every driver', () => {
    const paths = DATABASE_DRIVERS.map(
      (driver) =>
        renderToStaticMarkup(<DatabaseDriverIcon driver={driver} />).match(/ d="([^"]+)"/)?.[1]
    )
    expect(paths.every(Boolean)).toBe(true)
    expect(new Set(paths).size).toBe(DATABASE_DRIVERS.length)
  })

  it('is decorative and takes the surrounding text color', () => {
    const markup = renderToStaticMarkup(
      <DatabaseDriverIcon driver="postgres" style={{ color: '#ef4444' }} />
    )
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('fill="currentColor"')
    expect(markup).toContain('data-driver="postgres"')
    expect(markup).toContain('color:#ef4444')
  })
})
