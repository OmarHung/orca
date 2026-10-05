import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setMainHttpClient } from '../network/http-client'
import { MONDAY_API_VERSION } from '../../shared/monday/monday-types'
import { MondayApiError, mondayGraphql } from './monday-graphql-client'

vi.mock('../network/proxy-settings', () => ({
  ensureElectronProxyFromEnvironment: async () => ({})
}))

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

async function failureOf(promise: Promise<unknown>): Promise<MondayApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof MondayApiError) {
      return error
    }
    throw error
  }
  throw new Error('expected a MondayApiError')
}

beforeEach(() => {
  fetchMock.mockReset()
  setMainHttpClient({ fetch: fetchMock, proxySession: () => null })
})

afterEach(() => {
  setMainHttpClient(null)
})

describe('mondayGraphql', () => {
  it('sends the token, the pinned API version and the variables', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { me: { id: '1' } } }))
    const data = await mondayGraphql<{ me: { id: string } }>('tok', 'query { me { id } }', { a: 1 })
    expect(data.me.id).toBe('1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.monday.com/v2')
    expect(init?.headers).toMatchObject({ Authorization: 'tok', 'API-Version': MONDAY_API_VERSION })
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'query { me { id } }',
      variables: { a: 1 }
    })
  })

  it('reports a rejected token', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: [{ message: 'Not Authenticated' }] }, { status: 401 })
    )
    expect((await failureOf(mondayGraphql('tok', 'q', {}))).kind).toBe('unauthorized')
  })

  it('does not retry the account-wide daily limit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        errors: [
          {
            message: 'Daily limit',
            extensions: { code: 'DAILY_LIMIT_EXCEEDED', retry_in_seconds: 5 }
          }
        ]
      })
    )
    expect((await failureOf(mondayGraphql('tok', 'q', {}))).kind).toBe('daily-limit')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('waits out a short rate limit and retries once', async () => {
    const sleep = vi.fn(async () => undefined)
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          errors: [
            {
              message: 'Rate limit',
              extensions: { code: 'RATE_LIMIT_EXCEEDED', retry_in_seconds: 2 }
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }))
    await expect(mondayGraphql('tok', 'q', {}, { sleep })).resolves.toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('gives up on a long rate limit instead of hanging', async () => {
    const sleep = vi.fn(async () => undefined)
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error_code: 'ComplexityException', error_message: 'Budget', status_code: 429 },
        {
          status: 429,
          headers: { 'retry-after': '45' }
        }
      )
    )
    const failure = await failureOf(mondayGraphql('tok', 'q', {}, { sleep }))
    expect(failure.kind).toBe('rate-limited')
    expect(failure.retryInSeconds).toBe(45)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('surfaces other GraphQL errors with their message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'Field "x" does not exist' }] }))
    const failure = await failureOf(mondayGraphql('tok', 'q', {}))
    expect(failure.kind).toBe('api')
    expect(failure.message).toBe('Field "x" does not exist')
  })

  it('maps transport failures and empty bodies', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    expect((await failureOf(mondayGraphql('tok', 'q', {}))).kind).toBe('network')
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 502 }))
    const failure = await failureOf(mondayGraphql('tok', 'q', {}))
    expect(failure.kind).toBe('api')
    expect(failure.message).toContain('502')
  })
})
