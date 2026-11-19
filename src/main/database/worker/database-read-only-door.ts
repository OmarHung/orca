import {
  isSqlDriver,
  type DatabaseDriver
} from '../../../shared/database/database-connection-types'
import { parseRedisCommandWords } from '../../../shared/database/redis-command-text'
import {
  redisReadOnlyRefusal,
  redisReadOnlyViolation
} from '../../../shared/database/redis-read-only-commands'
import { readOnlyRefusal, readOnlyViolation } from '../../../shared/database/sql-read-only-guard'
import { mongoReadOnlyViolation } from './mongodb-shell-parser'

function redisRefusal(command: string): string | null {
  let words: string[]
  try {
    words = parseRedisCommandWords(command)
  } catch {
    // Why let it through: the console reports the syntax error, and a broken quote sends nothing.
    return null
  }
  const violation = redisReadOnlyViolation(words)
  return violation ? redisReadOnlyRefusal(violation) : null
}

/** Why a statement may not run, or null; every console and table statement passes this door. */
export function readOnlyRefusalFor(statement: string, driver: DatabaseDriver): string | null {
  if (driver === 'redis') {
    return redisRefusal(statement)
  }
  if (driver === 'mongodb') {
    return mongoReadOnlyViolation(statement)
  }
  if (!isSqlDriver(driver)) {
    return null
  }
  const violation = readOnlyViolation(statement, driver)
  return violation ? readOnlyRefusal(violation, driver) : null
}
