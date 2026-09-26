import { open, realpath } from 'node:fs/promises'

export type ExecutableArch = 'x64' | 'arm64'

const HEADER_BYTES = 4096
const MACHO_64_LE = 0xfeedfacf
const FAT_MAGIC_BE = 0xcafebabe
const CPU_TYPE_X86_64 = 0x01000007
const CPU_TYPE_ARM64 = 0x0100000c
const ELF_MAGIC = 0x7f454c46
const ELF_MACHINE_X86_64 = 0x3e
const ELF_MACHINE_AARCH64 = 0xb7
const PE_MACHINE_AMD64 = 0x8664
const PE_MACHINE_ARM64 = 0xaa64

function cpuTypeToArch(cpuType: number): ExecutableArch | null {
  return cpuType === CPU_TYPE_ARM64 ? 'arm64' : cpuType === CPU_TYPE_X86_64 ? 'x64' : null
}

/**
 * Architecture an executable runs as, read from its header. A universal (fat) binary runs
 * natively, so it reports `hostArch` when it contains that slice.
 */
export function parseExecutableArch(header: Buffer, hostArch: string): ExecutableArch | null {
  if (header.length < 64) {
    return null
  }
  if (header.readUInt32LE(0) === MACHO_64_LE) {
    return cpuTypeToArch(header.readUInt32LE(4))
  }
  if (header.readUInt32BE(0) === FAT_MAGIC_BE) {
    const count = header.readUInt32BE(4)
    const slices: ExecutableArch[] = []
    for (let index = 0; index < count && 8 + index * 20 + 4 <= header.length; index++) {
      const arch = cpuTypeToArch(header.readUInt32BE(8 + index * 20))
      if (arch) {
        slices.push(arch)
      }
    }
    return slices.find((arch) => arch === hostArch) ?? slices[0] ?? null
  }
  if (header.readUInt32BE(0) === ELF_MAGIC) {
    const machine = header.readUInt16LE(18)
    return machine === ELF_MACHINE_AARCH64 ? 'arm64' : machine === ELF_MACHINE_X86_64 ? 'x64' : null
  }
  if (header.toString('ascii', 0, 2) === 'MZ') {
    const peOffset = header.readUInt32LE(0x3c)
    if (
      peOffset + 6 > header.length ||
      header.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0'
    ) {
      return null
    }
    const machine = header.readUInt16LE(peOffset + 4)
    return machine === PE_MACHINE_ARM64 ? 'arm64' : machine === PE_MACHINE_AMD64 ? 'x64' : null
  }
  return null
}

/** Reads the architecture of the executable behind `path` (following symlinks). */
export async function readExecutableArch(
  path: string,
  hostArch: string = process.arch
): Promise<ExecutableArch | null> {
  const handle = await open(await realpath(path), 'r')
  try {
    const header = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0)
    return parseExecutableArch(header.subarray(0, bytesRead), hostArch)
  } finally {
    await handle.close()
  }
}
