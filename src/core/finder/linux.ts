import { readFile } from 'node:fs/promises'

import type { FindOptions, Listener, Protocol } from '../types'
import { execFile, isCommandNotFound } from '../../utils/exec'
import { uniqBy } from '../../utils/strings'

export class LinuxFinder {
  async listAll(): Promise<Listener[]> {
    // Prefer `ss` (fast) and enrich via /proc.
    // Fallback to `lsof` when `ss` is missing or doesn't provide PIDs.
    let out: Listener[] | null = null

    out = await this.trySsListAll()
    if (!out || out.length === 0) out = await this.tryLsofListAll()

    if (!out) return []

    await enrichFromProc(out)
    return dedupe(out)
  }

  async findByPort(port: number, options: FindOptions): Promise<Listener[]> {
    // Use ss filtering for speed. If empty, fallback to lsof (which may work under different perms).
    const protocols = options.protocols
    let out = await this.trySsFindByPort(port, protocols)

    if (out.length === 0) {
      const lsof = await this.tryLsofFindByPort(port, protocols)
      if (lsof) out = lsof
    }

    await enrichFromProc(out)
    return dedupe(out)
  }

  private async trySsListAll(): Promise<Listener[] | null> {
    try {
      const out: Listener[] = []

      const tcp = await execFile('ss', ['-H', '-ltnp'])
      out.push(...parseSs(tcp.stdout, 'tcp', 'ss'))

      const udp = await execFile('ss', ['-H', '-lunp'])
      out.push(...parseSs(udp.stdout, 'udp', 'ss'))

      // If ss couldn't provide PIDs (common when not root), treat as unusable and fallback.
      if (out.length === 0) return null

      return out
    } catch (err) {
      if (isCommandNotFound(err)) return null
      return null
    }
  }

  private async trySsFindByPort(port: number, protocols: Protocol[]): Promise<Listener[]> {
    try {
      const out: Listener[] = []
      if (protocols.includes('tcp')) {
        const tcp = await execFile('ss', ['-H', '-ltnp', `sport = :${port}`])
        out.push(...parseSs(tcp.stdout, 'tcp', 'ss'))
      }
      if (protocols.includes('udp')) {
        const udp = await execFile('ss', ['-H', '-lunp', `sport = :${port}`])
        out.push(...parseSs(udp.stdout, 'udp', 'ss'))
      }
      return out
    } catch (err) {
      if (isCommandNotFound(err)) return []
      return []
    }
  }


  private async tryLsofListAll(): Promise<Listener[] | null> {
    try {
      const out: Listener[] = []
      const tcp = await execFile('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
      out.push(...parseLsof(tcp.stdout, 'lsof'))
      const udp = await execFile('lsof', ['-nP', '-iUDP'])
      out.push(...parseLsof(udp.stdout, 'lsof'))
      return out
    } catch (err) {
      if (isCommandNotFound(err)) return null
      return null
    }
  }

  private async tryLsofFindByPort(port: number, protocols: Protocol[]): Promise<Listener[] | null> {
    try {
      const out: Listener[] = []
      if (protocols.includes('tcp')) {
        const tcp = await execFile('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
        out.push(...parseLsof(tcp.stdout, 'lsof'))
      }
      if (protocols.includes('udp')) {
        const udp = await execFile('lsof', ['-nP', `-iUDP:${port}`])
        out.push(...parseLsof(udp.stdout, 'lsof'))
      }
      return out
    } catch (err) {
      if (isCommandNotFound(err)) return null
      return null
    }
  }
}

function parseSs(stdout: string, protocol: Protocol, source: string): Listener[] {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: Listener[] = []

  for (const line of lines) {
    // Expected columns:
    // State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue

    const local = parts[3] ?? ''
    const proc = parts.slice(5).join(' ') // may be missing

    const { port, address } = parseAddrPort(local)
    if (!port) continue

    const pid = parseSsPid(proc)
    if (!pid) continue

    const name = parseSsName(proc)

    out.push({
      protocol,
      port,
      pid,
      localAddress: address,
      processName: name,
      raw: line,
      source,
    })
  }

  return out
}

function parseAddrPort(token: string): { port: number | null; address?: string } {
  // Examples: 0.0.0.0:3000, *:5173, [::]:22, :::8080
  const m = token.match(/:(\d+)$/)
  if (!m) return { port: null }

  const port = parseInt(m[1]!, 10)
  if (!Number.isFinite(port)) return { port: null }

  const address = token.slice(0, token.length - (m[1]!.length + 1))
  return { port, address }
}

function parseSsPid(proc: string): number | null {
  const m = proc.match(/pid=(\d+)/)
  if (!m) return null
  const pid = parseInt(m[1]!, 10)
  return Number.isFinite(pid) ? pid : null
}

function parseSsName(proc: string): string | undefined {
  const m = proc.match(/users:\(\("([^"]+)"/)
  return m?.[1]
}

function parseLsof(stdout: string, source: string): Listener[] {
  const lines = stdout.split(/\r?\n/)
  const out: Listener[] = []
  let sawHeader = false

  for (const line of lines) {
    if (!line.trim()) continue
    if (!sawHeader) {
      // COMMAND PID USER ...
      if (line.toLowerCase().startsWith('command')) {
        sawHeader = true
      }
      continue
    }

    // Typical: node 1234 user  23u IPv6 ... TCP *:3000 (LISTEN)
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue

    const cmd = parts[0]!
    const pid = parseInt(parts[1]!, 10)
    const user = parts[2]!
    const name = parts.slice(8).join(' ')

    const proto = name.startsWith('TCP') ? 'tcp' : name.startsWith('UDP') ? 'udp' : null
    if (!proto) continue

    const portMatch = name.match(/:(\d+)\b/)
    if (!portMatch) continue
    const port = parseInt(portMatch[1]!, 10)
    if (!Number.isFinite(port)) continue

    const addrMatch = name.match(/^\w+\s+([^\s]+):\d+/)
    const addr = addrMatch?.[1]

    out.push({
      protocol: proto,
      port,
      pid,
      user,
      localAddress: addr,
      processName: cmd,
      raw: line,
      source,
    })
  }

  return out
}


async function enrichFromProc(listeners: Listener[]): Promise<void> {
  // Best-effort enrichment: command line + uid->username.
  // We don't throw: missing permissions are expected.
  const uniqPids = [...new Set(listeners.map((l) => l.pid))]

  const uidToUser = new Map<string, string>()
  const uidCacheLoaded = { value: false }

  async function uidLookup(uid: string): Promise<string | undefined> {
    // Lazy parse /etc/passwd once.
    if (!uidCacheLoaded.value) {
      uidCacheLoaded.value = true
      try {
        const passwd = await readFile('/etc/passwd', 'utf8')
        for (const line of passwd.split('\n')) {
          if (!line || line.startsWith('#')) continue
          const cols = line.split(':')
          if (cols.length < 3) continue
          const name = cols[0]!
          const id = cols[2]!
          uidToUser.set(id, name)
        }
      } catch {
        // ignore
      }
    }
    return uidToUser.get(uid)
  }

  await Promise.all(
    uniqPids.map(async (pid) => {
      const base = `/proc/${pid}`

      let comm: string | undefined
      let cmdline: string | undefined
      let uid: string | undefined

      try {
        comm = (await readFile(`${base}/comm`, 'utf8')).trim()
      } catch {
        // ignore
      }

      try {
        const raw = await readFile(`${base}/cmdline`)
        // cmdline is NUL-separated
        cmdline = raw.toString('utf8').replace(/\u0000+/g, ' ').trim()
      } catch {
        // ignore
      }

      try {
        const status = await readFile(`${base}/status`, 'utf8')
        const m = status.match(/^Uid:\s+(\d+)/m)
        if (m) uid = m[1]
      } catch {
        // ignore
      }

      const user = uid ? await uidLookup(uid) : undefined

      for (const l of listeners) {
        if (l.pid !== pid) continue
        if (comm && !l.processName) l.processName = comm
        if (cmdline) l.command = cmdline
        if (user) l.user = user
      }
    }),
  )
}

function dedupe(listeners: Listener[]): Listener[] {
  // Dedupe common duplicates (IPv4+IPv6 entries etc.)
  return uniqBy(listeners, (l) => `${l.protocol}:${l.port}:${l.pid}:${l.localAddress ?? ''}`)
}