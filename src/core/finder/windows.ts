import type { FindOptions, Listener, Protocol } from '../types'
import { execFile, isCommandNotFound } from '../../utils/exec'
import { uniqBy } from '../../utils/strings'

export class WindowsFinder {
  async listAll(): Promise<Listener[]> {
    const tcp = await this.runNetstat(['-ano', '-p', 'tcp'])
    const udp = await this.runNetstat(['-ano', '-p', 'udp'])

    const parsed = [...parseNetstat(tcp, 'tcp'), ...parseNetstat(udp, 'udp')]
    const listeners = uniqBy(parsed, (l) => `${l.protocol}:${l.port}:${l.pid}:${l.localAddress ?? ''}`)

    // Enrich (best-effort): process name, command line, user.
    await enrichWindows(listeners)

    return listeners
  }

  async findByPort(port: number, options: FindOptions): Promise<Listener[]> {
    // Keep argument mode fast: do not run heavy enrichment here.
    const out: Listener[] = []

    if (options.protocols.includes('tcp')) {
      const tcp = await this.runNetstat(['-ano', '-p', 'tcp'])
      out.push(...parseNetstat(tcp, 'tcp').filter((l) => l.port === port))
    }

    if (options.protocols.includes('udp')) {
      const udp = await this.runNetstat(['-ano', '-p', 'udp'])
      out.push(...parseNetstat(udp, 'udp').filter((l) => l.port === port))
    }

    return uniqBy(out, (l) => `${l.protocol}:${l.port}:${l.pid}:${l.localAddress ?? ''}`)
  }

  private async runNetstat(args: string[]): Promise<string> {
    try {
      const res = await execFile('netstat', args, { timeoutMs: 2000 })
      return res.stdout
    } catch (err) {
      if (isCommandNotFound(err)) throw new Error('netstat not found.')
      throw err
    }
  }
}

function parseNetstat(stdout: string, proto: Protocol): Listener[] {
  const lines = stdout.split(/\r?\n/)
  const out: Listener[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Skip headers: "Active Connections", "Proto  Local Address ..."
    if (/^proto/i.test(line)) continue
    if (/^active/i.test(line)) continue

    // Split on whitespace; netstat aligns columns.
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue

    const p = parts[0]!.toLowerCase()
    if (p !== 'tcp' && p !== 'udp') continue

    // TCP: Proto Local Foreign State PID
    // UDP: Proto Local Foreign PID (no state)
    const hasState = p === 'tcp'
    const local = parts[1]!
    const state = hasState ? parts[3] : undefined
    const pidStr = parts[hasState ? 4 : 3]!

    if (hasState && state && state.toLowerCase() !== 'listening') continue

    const pid = parseInt(pidStr, 10)
    if (!Number.isFinite(pid)) continue

    const { port, address } = parseWindowsAddressPort(local)
    if (!port) continue

    out.push({
      protocol: proto,
      port,
      pid,
      localAddress: address,
      raw,
      source: 'netstat',
    })
  }

  return out
}

function parseWindowsAddressPort(local: string): { port: number | null; address?: string } {
  // Examples:
  //  0.0.0.0:135
  //  [::]:135
  //  127.0.0.1:3000
  const m = local.match(/^(.*):(\d+)$/)
  if (!m) return { port: null }
  const port = parseInt(m[2]!, 10)
  if (!Number.isFinite(port)) return { port: null }

  let address = m[1]!
  address = address.replace(/^\[|\]$/g, '') // strip brackets for IPv6
  return { port, address }
}


async function enrichWindows(listeners: Listener[]): Promise<void> {
  const pids = [...new Set(listeners.map((l) => l.pid))].sort((a, b) => a - b)

  if (pids.length === 0) return

  // Attempt PowerShell CIM for CommandLine + Owner.
  const ps = await tryPowerShellProcessInfo(pids)
  if (ps && ps.size) {
    for (const l of listeners) {
      const info = ps.get(l.pid)
      if (!info) continue
      if (info.name) l.processName = info.name
      if (info.cmd) l.command = info.cmd
      if (info.user) l.user = info.user
    }
    return
  }

  // Fallback: tasklist (CSV) for Image Name + User Name.
  const tl = await tryTasklistInfo()
  if (tl && tl.size) {
    for (const l of listeners) {
      const info = tl.get(l.pid)
      if (!info) continue
      if (info.name) l.processName = info.name
      if (info.user) l.user = info.user
      if (!l.command && info.name) l.command = info.name
    }
  }
}

type ProcInfo = { pid: number; name?: string; cmd?: string; user?: string }

async function tryPowerShellProcessInfo(pids: number[]): Promise<Map<number, ProcInfo> | null> {
  const list = pids.join(',')
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$pids = @(${list})`,
    '$items = @()',
    'foreach ($pid in $pids) {',
    '  try {',
    '    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$pid"',
    '    if ($null -eq $p) { continue }',
    '    $owner = $null',
    '    try {',
    '      $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner',
    '      if ($o -and $o.ReturnValue -eq 0) { $owner = ($o.Domain + "\\\\" + $o.User) }',
    '    } catch {}',
    '    $items += [pscustomobject]@{ pid = $pid; name = $p.Name; cmd = $p.CommandLine; user = $owner }',
    '  } catch {}',
    '}',
    '$items | ConvertTo-Json -Compress',
  ].join('; ')

  const stdout = await runPowerShell(script)
  if (!stdout) return null

  let parsed: any
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    return null
  }

  const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  const map = new Map<number, ProcInfo>()
  for (const it of arr) {
    const pid = Number(it?.pid)
    if (!Number.isFinite(pid)) continue
    map.set(pid, {
      pid,
      name: typeof it?.name === 'string' ? it.name : undefined,
      cmd: typeof it?.cmd === 'string' ? it.cmd : undefined,
      user: typeof it?.user === 'string' ? it.user : undefined,
    })
  }
  return map
}

async function tryTasklistInfo(): Promise<Map<number, { name?: string; user?: string }> | null> {
  try {
    // /V includes "User Name". /FO CSV makes parsing reliable.
    // Note: tasklist output encoding depends on system locale, we handle it best-effort
    const res = await execFile('tasklist', ['/V', '/FO', 'CSV', '/NH'], { timeoutMs: 3000 })
    const lines = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const map = new Map<number, { name?: string; user?: string }>()

    for (const line of lines) {
      const row = parseCsvLine(line)
      // Expected columns: "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
      if (row.length < 7) continue
      const name = row[0]
      const pid = parseInt(row[1] ?? '', 10)
      let user: string | undefined = row[6]
      if (!Number.isFinite(pid)) continue
      
      // Clean up user field - remove garbled characters
      if (user && /[\uFFFD]|锟斤拷|��/.test(user)) {
        user = undefined
      }
      
      map.set(pid, { name, user })
    }

    return map
  } catch {
    return null
  }
}

function parseCsvLine(line: string): string[] {
  // Minimal CSV parser for tasklist output.
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === ',') {
      i++
      continue
    }
    if (line[i] === '"') {
      i++
      let cur = ''
      while (i < line.length) {
        const ch = line[i]!
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i += 2
            continue
          }
          i++
          break
        }
        cur += ch
        i++
      }
      out.push(cur)
      // skip until next comma
      while (i < line.length && line[i] !== ',') i++
      continue
    }

    // Unquoted field
    let cur = ''
    while (i < line.length && line[i] !== ',') {
      cur += line[i]!
      i++
    }
    out.push(cur.trim())
  }
  return out
}

async function runPowerShell(script: string): Promise<string | null> {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
  try {
    const res = await execFile('powershell.exe', args, { timeoutMs: 2000 })
    return res.stdout
  } catch (err) {
    if (isCommandNotFound(err)) {
      try {
        const res = await execFile('powershell', args, { timeoutMs: 2000 })
        return res.stdout
      } catch {
        return null
      }
    }
    return null
  }
}