import { vi } from 'vitest'

type Respond = (query: string, variables: Record<string, unknown>, token: string) => unknown

/** A stand-in for `mondayGraphql`: `call` goes where the transport goes, `mock` records calls. */
export function createFakeMondayGraphql(respond: Respond) {
  const mock = vi.fn(async (token: string, query: string, variables: Record<string, unknown>) =>
    respond(query, variables, token)
  )
  const call = <T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each test's fake answers with the shape the query under test reads.
    mock(token, query, variables) as Promise<T>
  return { mock, call }
}
