import type { Protocol } from '../core/types'

export interface PortRequest {
  raw: string
  port: number
  /** Per-argument protocol override (e.g. 3000/tcp). If undefined, use global flags. */
  protocols?: Protocol[]
}

export interface ProcessNameRequest {
  raw: string
  name: string
}

export interface CLIFlags {
  help: boolean
  version: boolean
  list: boolean
  json: boolean
  force: boolean
  dryRun: boolean
  tcp: boolean
  udp: boolean
  timeoutMs: number
  pid?: number
}

export interface ParsedArgs {
  flags: CLIFlags
  ports: PortRequest[]
  processNames: ProcessNameRequest[]
  unknown: string[]
}

const DEFAULT_TIMEOUT_MS = 1200

export function defaultTimeoutMs(): number {
  return DEFAULT_TIMEOUT_MS
}

export function resolveProtocols(flags: Pick<CLIFlags, 'tcp' | 'udp'>): Protocol[] {
  if (flags.tcp && !flags.udp) return ['tcp']
  if (flags.udp && !flags.tcp) return ['udp']
  return ['tcp', 'udp']
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: CLIFlags = {
    help: false,
    version: false,
    list: false,
    json: false,
    force: false,
    dryRun: false,
    tcp: false,
    udp: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  const ports: PortRequest[] = []
  const processNames: ProcessNameRequest[] = []
  const unknown: string[] = []

  const args = [...argv]
  let i = 0
  let stopParsing = false


  while (i < args.length) {
    const a = args[i]!

    if (!stopParsing && a === '--') {
      stopParsing = true
      i++
      continue
    }

    if (!stopParsing && a.startsWith('-')) {
      // Flags
      if (a === '-h' || a === '--help') {
        flags.help = true
        i++
        continue
      }

      if (a === '-v' || a === '--version') {
        flags.version = true
        i++
        continue
      }

      if (a === '-l' || a === '--list') {
        flags.list = true
        i++
        continue
      }

      if (a === '--json' || a === '-j') {
        flags.json = true
        i++
        continue
      }

      if (a === '-f' || a === '--force') {
        flags.force = true
        i++
        continue
      }

      if (a === '--dry-run') {
        flags.dryRun = true
        i++
        continue
      }

      if (a === '--tcp') {
        flags.tcp = true
        i++
        continue
      }

      if (a === '--udp') {
        flags.udp = true
        i++
        continue
      }

      if (a.startsWith('--timeout=')) {
        const v = a.slice('--timeout='.length)
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n >= 0) flags.timeoutMs = n
        else unknown.push(a)
        i++
        continue
      }

      if (a === '--timeout') {
        const v = args[i + 1]
        if (v == null) {
          unknown.push(a)
          i++
          continue
        }
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n >= 0) flags.timeoutMs = n
        else unknown.push(`${a} ${v}`)
        i += 2
        continue
      }

      if (a.startsWith('--pid=')) {
        const v = a.slice('--pid='.length)
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n > 0) flags.pid = n
        else unknown.push(a)
        i++
        continue
      }

      if (a === '--pid') {
        const v = args[i + 1]
        if (v == null) {
          unknown.push(a)
          i++
          continue
        }
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n > 0) flags.pid = n
        else unknown.push(`${a} ${v}`)
        i += 2
        continue
      }

      // Compact short flags: -lf or -fj etc.
      if (/^-[a-zA-Z]{2,}$/.test(a)) {
        let consumed = true
        for (const ch of a.slice(1)) {
          if (ch === 'h') flags.help = true
          else if (ch === 'v') flags.version = true
          else if (ch === 'l') flags.list = true
          else if (ch === 'j') flags.json = true
          else if (ch === 'f') flags.force = true
          else {
            consumed = false
            break
          }
        }
        if (consumed) {
          i++
          continue
        }
      }

      unknown.push(a)
      i++
      continue
    }

    // Positional: port, port/proto, or process name
    const pr = parsePortRequest(a)
    if (pr) {
      ports.push(pr)
      i++
      continue
    }

    // Check if it's a process name (contains letters, optionally ends with .exe)
    const pn = parseProcessName(a)
    if (pn) {
      processNames.push(pn)
      i++
      continue
    }

    unknown.push(a)
    i++
  }

  // If user passed both --tcp and --udp, treat as "both" (default).
  if (flags.tcp && flags.udp) {
    // no-op; resolveProtocols will include both
  }

  // If --json without --list, it's probably a mistake.
  if (flags.json && !flags.list) {
    unknown.push('--json')
    flags.json = false
  }

  // If --pid is present, ports are ignored (but not treated as unknown).
  if (typeof flags.pid === 'number') {
    return { flags, ports: [], processNames: [], unknown }
  }

  return { flags, ports, processNames, unknown }
}

function parsePortRequest(raw: string): PortRequest | null {
  // Formats:
  //  - 3000
  //  - 3000/tcp
  //  - 3000/udp
  const m = raw.match(/^(\d{1,5})(?:\/(tcp|udp))?$/i)
  if (!m) return null

  const port = parseInt(m[1]!, 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null

  const proto = m[2]?.toLowerCase()
  if (proto === 'tcp' || proto === 'udp') {
    return { raw, port, protocols: [proto] }
  }

  return { raw, port }
}


function parseProcessName(raw: string): ProcessNameRequest | null {
  // Must contain at least one letter, can end with .exe
  // Examples: node, node.exe, chrome, python3
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(raw)) return null
  // Exclude things that look like flags or paths
  if (raw.startsWith('-') || raw.includes('/') || raw.includes('\\')) return null
  
  return { raw, name: raw }
}