import { describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import { routeThroughTunnel } from './database-connection-route'

const server: DatabaseConnectionDraft = {
  driver: 'postgres',
  name: 'prod',
  host: 'db.internal',
  port: 5432,
  database: 'app',
  user: 'dev',
  sslMode: 'verify-full',
  readOnly: false,
  passwordStorage: 'never',
  sshTunnel: { targetId: 'ssh-1' }
}

describe('routeThroughTunnel', () => {
  it('dials the local tunnel end while TLS keeps naming the real server', () => {
    expect(routeThroughTunnel(server, 41000)).toMatchObject({
      host: '127.0.0.1',
      port: 41000,
      tlsServerName: 'db.internal'
    })
  })

  it('leaves direct connections and SQLite files alone', () => {
    expect(routeThroughTunnel(server, undefined)).toBe(server)
    const file: DatabaseConnectionDraft = {
      driver: 'sqlite',
      name: 'app.db',
      filePath: '/tmp/app.db',
      readOnly: false
    }
    expect(routeThroughTunnel(file, 41000)).toBe(file)
  })
})
