import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../../../shared/ssh-types'
import {
  filterSshTargetsBySearchQuery,
  SSH_TARGET_SEARCH_QUERY_MAX_BYTES
} from './ssh-target-search'

function target(overrides: Partial<SshTarget> & Pick<SshTarget, 'id' | 'label'>): SshTarget {
  return { host: '192.0.2.1', port: 22, username: 'dev', ...overrides }
}

const targets: SshTarget[] = [
  target({
    id: 'web-prod',
    label: 'web-prod-203.0.113.10',
    host: '203.0.113.10',
    username: 'deploy',
    identityFile: '/home/dev/.ssh/web_prod'
  }),
  target({ id: 'monitor', label: 'monitor-198.51.100.7', host: '198.51.100.7' }),
  target({
    id: 'monitor-ci',
    label: 'monitor-198.51.100.7-ci',
    host: '198.51.100.7',
    username: 'ci',
    port: 2222
  }),
  target({
    id: 'aws',
    label: 'aws-192.0.2.44',
    configHost: 'aws-192.0.2.44',
    host: 'ec2-192-0-2-44.ap-southeast-2.compute.amazonaws.com',
    username: 'ubuntu'
  })
]

function ids(query: string): string[] {
  return filterSshTargetsBySearchQuery(targets, query).map((t) => t.id)
}

describe('filterSshTargetsBySearchQuery', () => {
  it('returns every target, in order, for an empty or blank query', () => {
    const all = ['web-prod', 'monitor', 'monitor-ci', 'aws']
    expect(ids('')).toEqual(all)
    expect(ids('   ')).toEqual(all)
  })

  it('matches the label case-insensitively', () => {
    expect(ids('web-prod')).toEqual(['web-prod'])
    expect(ids('AWS')).toEqual(['aws'])
  })

  it('matches the host, user, and port shown on the card', () => {
    expect(ids('amazonaws')).toEqual(['aws'])
    expect(ids('ubuntu@')).toEqual(['aws'])
    expect(ids(':2222')).toEqual(['monitor-ci'])
  })

  it('matches the identity file path', () => {
    expect(ids('.ssh/web_prod')).toEqual(['web-prod'])
  })

  it('requires every whitespace-separated term to match', () => {
    expect(ids('198.51 ci@')).toEqual(['monitor-ci'])
    expect(ids('198.51 ubuntu')).toEqual([])
  })

  it('does not let one term span two fields', () => {
    expect(ids('10deploy')).toEqual([])
  })

  it('returns nothing for an oversized pasted query', () => {
    expect(ids('a'.repeat(SSH_TARGET_SEARCH_QUERY_MAX_BYTES + 1))).toEqual([])
  })
})
