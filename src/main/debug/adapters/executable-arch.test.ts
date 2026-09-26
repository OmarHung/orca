import { describe, expect, it } from 'vitest'
import { parseExecutableArch, readExecutableArch } from './executable-arch'

function header(size = 128): Buffer {
  return Buffer.alloc(size)
}

function machO(cpuType: number): Buffer {
  const bytes = header()
  bytes.writeUInt32LE(0xfeedfacf, 0)
  bytes.writeUInt32LE(cpuType, 4)
  return bytes
}

function fat(cpuTypes: number[]): Buffer {
  const bytes = header()
  bytes.writeUInt32BE(0xcafebabe, 0)
  bytes.writeUInt32BE(cpuTypes.length, 4)
  cpuTypes.forEach((cpuType, index) => bytes.writeUInt32BE(cpuType, 8 + index * 20))
  return bytes
}

describe('parseExecutableArch', () => {
  it('reads thin Mach-O binaries (an Intel dotnet on Apple Silicon is x64)', () => {
    expect(parseExecutableArch(machO(0x01000007), 'arm64')).toBe('x64')
    expect(parseExecutableArch(machO(0x0100000c), 'arm64')).toBe('arm64')
  })

  it('reports the native slice of a universal binary', () => {
    const universal = fat([0x01000007, 0x0100000c])
    expect(parseExecutableArch(universal, 'arm64')).toBe('arm64')
    expect(parseExecutableArch(universal, 'x64')).toBe('x64')
  })

  it('reads ELF and PE machine types', () => {
    const elf = header()
    elf.writeUInt32BE(0x7f454c46, 0)
    elf.writeUInt16LE(0xb7, 18)
    expect(parseExecutableArch(elf, 'x64')).toBe('arm64')

    const pe = header()
    pe.write('MZ', 0, 'ascii')
    pe.writeUInt32LE(64, 0x3c)
    pe.write('PE\0\0', 64, 'ascii')
    pe.writeUInt16LE(0x8664, 68)
    expect(parseExecutableArch(pe, 'arm64')).toBe('x64')
  })

  it('returns null for anything else', () => {
    expect(parseExecutableArch(Buffer.from('#!/bin/sh\n'.padEnd(80, ' ')), 'x64')).toBeNull()
  })
})

describe('readExecutableArch', () => {
  it('reads the running node binary', async () => {
    const arch = await readExecutableArch(process.execPath)
    // Why arm64/x64 only: CI runs on one of the two, and Rosetta can mix them.
    expect(['x64', 'arm64']).toContain(arch)
  })
})
