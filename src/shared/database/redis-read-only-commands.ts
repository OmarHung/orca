/**
 * Redis has no read-only session for a primary, so the console sends only commands on this
 * allowlist: ones that read (or, like SELECT, only move this console's own session). Anything
 * else, including unknown module commands, is refused before it reaches the server.
 */

/** Orca's own command for the key viewer: reads one key's whole value a page at a time. */
export const REDIS_VIEW_COMMAND = 'ORCA.VIEW'

const READ_COMMANDS = new Set([
  REDIS_VIEW_COMMAND,
  // Keyspace
  'DBSIZE',
  'DUMP',
  'EXISTS',
  'EXPIRETIME',
  'KEYS',
  'PEXPIRETIME',
  'PTTL',
  'RANDOMKEY',
  'SCAN',
  'SELECT',
  'SORT_RO',
  'TTL',
  'TYPE',
  // Strings and bitmaps
  'BITCOUNT',
  'BITFIELD_RO',
  'BITPOS',
  'GET',
  'GETBIT',
  'GETRANGE',
  'LCS',
  'MGET',
  'STRLEN',
  'SUBSTR',
  // Hashes
  'HEXISTS',
  'HEXPIRETIME',
  'HGET',
  'HGETALL',
  'HKEYS',
  'HLEN',
  'HMGET',
  'HPEXPIRETIME',
  'HPTTL',
  'HRANDFIELD',
  'HSCAN',
  'HSTRLEN',
  'HTTL',
  'HVALS',
  // Lists
  'LINDEX',
  'LLEN',
  'LPOS',
  'LRANGE',
  // Sets
  'SCARD',
  'SDIFF',
  'SINTER',
  'SINTERCARD',
  'SISMEMBER',
  'SMEMBERS',
  'SMISMEMBER',
  'SRANDMEMBER',
  'SSCAN',
  'SUNION',
  // Sorted sets
  'ZCARD',
  'ZCOUNT',
  'ZDIFF',
  'ZINTER',
  'ZINTERCARD',
  'ZLEXCOUNT',
  'ZMSCORE',
  'ZRANDMEMBER',
  'ZRANGE',
  'ZRANGEBYLEX',
  'ZRANGEBYSCORE',
  'ZRANK',
  'ZREVRANGE',
  'ZREVRANGEBYLEX',
  'ZREVRANGEBYSCORE',
  'ZREVRANK',
  'ZSCAN',
  'ZSCORE',
  'ZUNION',
  // Streams
  'XINFO',
  'XLEN',
  'XPENDING',
  'XRANGE',
  'XREAD',
  'XREVRANGE',
  // HyperLogLog and geo
  'GEODIST',
  'GEOHASH',
  'GEOPOS',
  'GEORADIUSBYMEMBER_RO',
  'GEORADIUS_RO',
  'GEOSEARCH',
  'PFCOUNT',
  // Scripts the server runs with writes refused
  'EVALSHA_RO',
  'EVAL_RO',
  'FCALL_RO',
  // Server
  'ECHO',
  'INFO',
  'LASTSAVE',
  'PING',
  'ROLE',
  'TIME',
  // RedisJSON, RediSearch and RedisTimeSeries reads
  'FT.AGGREGATE',
  'FT.INFO',
  'FT.SEARCH',
  'FT._LIST',
  'JSON.ARRINDEX',
  'JSON.ARRLEN',
  'JSON.GET',
  'JSON.MGET',
  'JSON.OBJKEYS',
  'JSON.OBJLEN',
  'JSON.STRLEN',
  'JSON.TYPE',
  'TS.GET',
  'TS.INFO',
  'TS.MGET',
  'TS.MRANGE',
  'TS.MREVRANGE',
  'TS.QUERYINDEX',
  'TS.RANGE',
  'TS.REVRANGE'
])

/** Container commands, allowed only with a subcommand that reads. */
const READ_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  ACL: new Set(['CAT', 'GETUSER', 'USERS', 'WHOAMI']),
  CLIENT: new Set(['GETNAME', 'ID', 'INFO', 'LIST']),
  CLUSTER: new Set(['COUNTKEYSINSLOT', 'INFO', 'KEYSLOT', 'MYID', 'NODES', 'SHARDS', 'SLOTS']),
  COMMAND: new Set(['COUNT', 'DOCS', 'GETKEYS', 'GETKEYSANDFLAGS', 'INFO', 'LIST']),
  CONFIG: new Set(['GET']),
  FUNCTION: new Set(['LIST', 'STATS']),
  LATENCY: new Set(['DOCTOR', 'HISTOGRAM', 'HISTORY', 'LATEST']),
  MEMORY: new Set(['DOCTOR', 'MALLOC-STATS', 'STATS', 'USAGE']),
  MODULE: new Set(['LIST']),
  OBJECT: new Set(['ENCODING', 'FREQ', 'IDLETIME', 'REFCOUNT']),
  PUBSUB: new Set(['CHANNELS', 'NUMPAT', 'NUMSUB', 'SHARDCHANNELS', 'SHARDNUMSUB']),
  SCRIPT: new Set(['EXISTS']),
  SLOWLOG: new Set(['GET', 'LEN'])
}

/** Why `words` is refused, or null when the command only reads. */
export function redisReadOnlyViolation(words: readonly string[]): string | null {
  const command = words[0]?.toUpperCase()
  if (!command) {
    return null
  }
  if (READ_COMMANDS.has(command)) {
    return null
  }
  const subcommands = Object.hasOwn(READ_SUBCOMMANDS, command)
    ? READ_SUBCOMMANDS[command]
    : undefined
  if (subcommands) {
    const subcommand = words[1]?.toUpperCase()
    return subcommand && subcommands.has(subcommand)
      ? null
      : `${command} ${subcommand ?? ''}`.trim()
  }
  return command
}

export function redisReadOnlyRefusal(command: string): string {
  return `Orca's database tool is read-only: ${command} is not on its list of Redis commands that only read.`
}
