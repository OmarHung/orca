import { TYPE } from 'tedious/lib/data-type'
import type { Metadata } from 'tedious/lib/metadata-parser'
import { NotEnoughDataError } from 'tedious/lib/token/helpers'
import type { ParserOptions } from 'tedious/lib/token/stream-parser'
import { readValue } from 'tedious/lib/value-parser'
import { describe, expect, it } from 'vitest'

// tedious as patched by config/patches/tedious@20.0.0.patch: decimal, numeric and money come
// back as exact text, never through a JS number.

const OPTIONS: ParserOptions = {
  useUTC: true,
  lowerCaseGuids: false,
  tdsVersion: '7_4',
  useColumnNames: false,
  columnNameReplacer: undefined,
  camelCaseColumns: false
}

function metadata(typeId: 106 | 108 | 110, precision?: number, scale?: number): Metadata {
  return {
    userType: 0,
    flags: 0,
    type: TYPE[typeId],
    collation: undefined,
    precision,
    scale,
    dataLength: undefined,
    schema: undefined,
    udtInfo: undefined
  }
}

/** A DECIMALN/NUMERICN value on the wire: length, sign, then the unscaled magnitude LE. */
function numericBytes(unscaled: bigint, byteLength: 4 | 8 | 12 | 16): Buffer {
  const magnitude = unscaled < 0n ? -unscaled : unscaled
  const bytes = Buffer.alloc(byteLength)
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] = Number((magnitude >> BigInt(index * 8)) & 0xffn)
  }
  return Buffer.concat([Buffer.from([byteLength + 1, unscaled < 0n ? 0 : 1]), bytes])
}

function moneyBytes(unscaled: bigint): Buffer {
  const bytes = Buffer.alloc(9)
  bytes[0] = 8
  const twos = BigInt.asUintN(64, unscaled)
  bytes.writeInt32LE(Number(BigInt.asIntN(32, twos >> 32n)), 1)
  bytes.writeUInt32LE(Number(twos & 0xffffffffn), 5)
  return bytes
}

describe('SQL Server exact numbers', () => {
  it('reads decimal(38,18) and numeric past 2^53 digit for digit', () => {
    const decimal = numericBytes(12345678901234567890123456789012345678n, 16)
    expect(readValue(decimal, 0, metadata(106, 38, 18), OPTIONS).value).toBe(
      '12345678901234567890.123456789012345678'
    )
    const numeric = numericBytes(99999999999999999999999999999999999999n, 16)
    expect(readValue(numeric, 0, metadata(108, 38, 0), OPTIONS).value).toBe(
      '99999999999999999999999999999999999999'
    )
    // One past Number.MAX_SAFE_INTEGER, which a JS number would round.
    const pastSafe = numericBytes(9007199254740993n, 8)
    expect(readValue(pastSafe, 0, metadata(108, 19, 0), OPTIONS).value).toBe('9007199254740993')
  })

  it('keeps the sign, the scale’s trailing zeros and the leading zero of a fraction', () => {
    expect(readValue(numericBytes(-50n, 4), 0, metadata(106, 5, 2), OPTIONS).value).toBe('-0.50')
    expect(readValue(numericBytes(5n, 12), 0, metadata(106, 28, 4), OPTIONS).value).toBe('0.0005')
    expect(readValue(numericBytes(0n, 4), 0, metadata(106, 5, 2), OPTIONS).value).toBe('0.00')
  })

  it('reads money at both ends of its range, and smallmoney, with four decimals', () => {
    const money = metadata(110)
    expect(readValue(moneyBytes(9223372036854775807n), 0, money, OPTIONS).value).toBe(
      '922337203685477.5807'
    )
    expect(readValue(moneyBytes(-9223372036854775808n), 0, money, OPTIONS).value).toBe(
      '-922337203685477.5808'
    )
    const small = Buffer.from([4, 0, 0, 0, 0])
    small.writeInt32LE(-2147483648, 1)
    expect(readValue(small, 0, money, OPTIONS).value).toBe('-214748.3648')
  })

  it('asks for more bytes when a value is cut off, as the stream parser expects', () => {
    const whole = numericBytes(12345678901234567890123456789012345678n, 16)
    expect(() => readValue(whole.subarray(0, 10), 0, metadata(106, 38, 18), OPTIONS)).toThrow(
      NotEnoughDataError
    )
  })
})
