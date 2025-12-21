import pc from 'picocolors'

import { parseArgs, resolveProtocols, type ProcessNameRequest } from './cli/args'
import { printHelp } from './cli/help'
import { getFinder } from './core/finder'
import { getKiller } from './core/killer'
import type { Listener, Protocol } from './core/types'
import { protectionFor, refusalMessage } from './core/safety'
import { version } from './version'
import { isWindowsAdmin } from './utils/windows'
import { uniqBy } from './utils/strings'
import { withSpinner } from './ui/spinner'
import {
  formatKillLine,
  formatListenerRow,
  lineErr,
  lineInfo,
  lineOk,
  sym,
} from './ui/renderer'

async function main(): Promise<void> {
  const { flags, ports, processNames, unknown } = parseArgs(process.argv.slice(2))

  if (flags.help) {
    printHelp()
    return
  }

  if (flags.version) {
    process.stdout.write(`${version}\n`)
    return
  }

  if (unknown.length) {
    process.stderr.write(lineErr(`Unknown arguments: ${unknown.join(' ')}`) + '\n')
    process.stderr.write(lineInfo(`Run ${pc.bold('kkp --help')} for usage.`) + '\n')
    process.exitCode = 1
    return
  }

  const allowedProtocols = resolveProtocols(flags)

  // `kkp` (no args) => interactive TUI
  if (!flags.list && flags.pid == null && ports.length === 0 && processNames.length === 0) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write(lineErr('Interactive mode requires a TTY.') + '\n')
      process.stderr.write(lineInfo(`Try ${pc.bold('kkp --list')} or ${pc.bold('kkp <port>')}.`) + '\n')
      process.exitCode = 1
      return
    }

    const finder = await getFinder()
    const listeners = await withSpinner('Scanning listeners', () => finder.listAll())


    if (listeners.length === 0) {
      process.stdout.write(lineInfo('No listeners found.') + '\n')
      return
    }

    const mod = await import('./ui/tui')
    const result = await mod.selectListeners(listeners)

    if (result.cancelled) {
      // If Ctrl+C happened, we keep exit code 130, otherwise a clean exit.
      return
    }

    await killResolvedListeners(result.selected, allowedProtocols, flags.force, flags.dryRun, flags.timeoutMs)
    return
  }

  // `kkp --list`
  if (flags.list) {
    const finder = await getFinder()
    const listeners = await withSpinner('Scanning listeners', () => finder.listAll())

    const filtered = listeners.filter((l) => allowedProtocols.includes(l.protocol))

    if (flags.json) {
      process.stdout.write(JSON.stringify(filtered, null, 2) + '\n')
      return
    }

    if (filtered.length === 0) {
      process.stdout.write(lineInfo('No listeners found.') + '\n')
      return
    }

    renderTable(filtered)
    return
  }

  // `kkp --pid 1234`
  if (typeof flags.pid === 'number') {
    const pid = flags.pid
    const killer = await getKiller()

    const pseudo: Listener = { pid, port: 0, protocol: 'tcp' }
    const prot = protectionFor(pseudo)

    if (prot.protected && !flags.force) {
      process.stderr.write(lineErr(refusalMessage(pseudo, prot.reason ?? 'protected')) + '\n')
      process.stderr.write(lineInfo(`Re-run with ${pc.bold('--force')} to override.`) + '\n')
      process.exitCode = 1
      return
    }

    if (flags.dryRun) {
      process.stdout.write(lineOk(`${sym.ok} would kill ${pc.bold(`#${pid}`)}`) + '\n')
      return
    }

    const res = await withSpinner(`Killing #${pid}`, () =>
      killer.kill(pid, { force: flags.force, timeoutMs: flags.timeoutMs }),
    )

    if (res.ok) {
      process.stdout.write(lineOk(`${sym.ok} killed ${pc.bold(`#${pid}`)} ${pc.dim(res.method)}`) + '\n')
      return
    }

    process.stderr.write(lineErr(`${sym.err} failed to kill ${pc.bold(`#${pid}`)}: ${res.message ?? 'unknown error'}`) + '\n')
    if (res.errorCode === 'EPERM') await hintElevationForPid(pid)
    process.exitCode = 1
    return
  }

  // `kkp 3000 [5173 ...]` or `kkp node [chrome ...]`
  const finder = await getFinder()
  
  // Handle process names first
  if (processNames.length > 0) {
    await killByProcessNames(finder, processNames, allowedProtocols, flags.force, flags.dryRun, flags.timeoutMs)
  }
  
  // Handle ports
  if (ports.length > 0) {
    await killByPorts(finder, ports, allowedProtocols, flags.force, flags.dryRun, flags.timeoutMs)
  }
}

function renderTable(listeners: Listener[]): void {
  const portW = Math.max(4, maxLen(listeners.map((l) => String(l.port))))
  const pidW = Math.max(4, maxLen(listeners.map((l) => String(l.pid))))
  const userW = Math.max(4, maxLen(listeners.map((l) => l.user ?? '')))
  const addrW = Math.max(3, maxLen(listeners.map((l) => l.localAddress ?? '')))

  for (const l of listeners) {
    process.stdout.write(
      formatListenerRow(l, {
        portW,
        pidW,
        userW: Math.min(userW, 18),
        addrW: Math.min(addrW, 26),
      }) + '\n',
    )
  }

  // Summary line
  const tcpCount = listeners.filter((l) => l.protocol === 'tcp').length
  const udpCount = listeners.filter((l) => l.protocol === 'udp').length
  const summary = pc.dim(`\n${listeners.length} listeners (${tcpCount} tcp, ${udpCount} udp)`)
  process.stdout.write(summary + '\n')
}

async function killByProcessNames(
  finder: Awaited<ReturnType<typeof getFinder>>,
  targets: ProcessNameRequest[],
  allowedProtocols: Protocol[],
  force: boolean,
  dryRun: boolean,
  timeoutMs: number,
): Promise<void> {
  const allListeners = await withSpinner('Scanning listeners', () => finder.listAll())
  
  const matched: Listener[] = []
  
  for (const t of targets) {
    const name = t.name.toLowerCase().replace(/\.exe$/i, '')
    
    const found = allListeners.filter((l) => {
      if (!l.processName) return false
      const pname = l.processName.toLowerCase().replace(/\.exe$/i, '')
      return pname === name || pname.includes(name)
    })
    
    if (found.length === 0) {
      process.stderr.write(lineErr(`${sym.err} ${pc.bold(t.raw)} ${pc.dim('no matching process found')}`) + '\n')
      process.exitCode = 1
    } else {
      matched.push(...found)
    }
  }
  
  if (matched.length === 0) {
    if (process.exitCode == null) process.exitCode = 1
    return
  }
  
  // Filter by protocol and dedupe
  const filtered = matched.filter((l) => allowedProtocols.includes(l.protocol))
  const unique = uniqBy(filtered, (l) => String(l.pid))
  
  await killResolvedListeners(unique, allowedProtocols, force, dryRun, timeoutMs)
}

async function killByPorts(
  finder: Awaited<ReturnType<typeof getFinder>>,
  targets: Array<{ port: number; protocols?: Protocol[] }>,
  allowedProtocols: Protocol[],
  force: boolean,
  dryRun: boolean,
  timeoutMs: number,
): Promise<void> {
  const all: Listener[] = []

  for (const t of targets) {
    const protocols = (t.protocols ?? allowedProtocols).filter((p) => allowedProtocols.includes(p))
    if (protocols.length === 0) continue

    const found = await withSpinner(`Looking up :${t.port}`, () => finder.findByPort(t.port, { protocols }))
    all.push(...found)

    if (found.length === 0) {
      process.stderr.write(lineErr(`${sym.err} ${pc.bold(String(t.port))} ${pc.dim('no listener found')}`) + '\n')
      process.exitCode = 1
    }
  }

  if (all.length === 0) {
    // If we already printed "no listener found" lines, keep exitCode=1; else be gentle.
    if (process.exitCode == null) process.exitCode = 1
    return
  }

  await killResolvedListeners(all, ['tcp', 'udp'], force, dryRun, timeoutMs)
}


async function killResolvedListeners(
  listeners: Listener[],
  allowedProtocols: Protocol[],
  force: boolean,
  dryRun: boolean,
  timeoutMs: number,
): Promise<void> {
  const actionable = listeners.filter((l) => allowedProtocols.includes(l.protocol))

  if (actionable.length === 0) {
    process.stdout.write(lineInfo('No actionable listeners.') + '\n')
    return
  }

  // Kill each PID once (but still print one line per selected/identified listener).
  const unique = uniqBy(actionable, (l) => String(l.pid))

  type PerPidResult = { ok: boolean; method?: string; message?: string; errorCode?: string }
  const perPid = new Map<number, PerPidResult>()

  const killer = await getKiller()

  for (const l of unique) {
    const prot = protectionFor(l)
    if (prot.protected && !force) {
      perPid.set(l.pid, { ok: false, message: prot.reason ?? 'protected', errorCode: 'EPERM' })
      continue
    }

    if (dryRun) {
      perPid.set(l.pid, { ok: true, method: 'dry-run' })
      continue
    }

    const r = await withSpinner(`Killing ${formatKillLine(l)}`, () => killer.kill(l.pid, { force, timeoutMs }))
    perPid.set(l.pid, { ok: r.ok, method: r.method, message: r.message, errorCode: r.errorCode })
  }

  for (const l of actionable) {
    const r = perPid.get(l.pid)
    if (!r) continue

    if (r.ok) {
      const method = r.method ? pc.dim(r.method) : ''
      process.stdout.write(lineOk(`${sym.ok} ${formatKillLine(l)} ${method}`.trimEnd()) + '\n')
      continue
    }

    const reason = r.message ? pc.dim(r.message) : pc.dim('failed')
    process.stderr.write(lineErr(`${sym.err} ${formatKillLine(l)} ${reason}`) + '\n')

    if (r.errorCode === 'EPERM') {
      await hintElevationForListener(l)
      // Only suggest --force if this was blocked by kkp's protection, not OS permission
      if (!force && r.message === 'protected') {
        process.stderr.write(lineInfo(`Re-run with ${pc.bold('--force')} to override protected checks.`) + '\n')
      }
    }

    process.exitCode = 1
  }
}

async function hintElevationForListener(l: Listener): Promise<void> {
  if (process.platform === 'win32') {
    const isAdmin = await isWindowsAdmin()
    const msg = isAdmin
      ? 'Access denied (even as Administrator). The process may be protected or owned by another security context.'
      : 'Access denied. Try running in an elevated terminal (Run as Administrator).'
    process.stderr.write(lineInfo(msg) + '\n')
    return
  }

  const port = l.port ? ` ${l.port}` : ''
  process.stderr.write(lineInfo(`Permission denied. Try: sudo kkp${port}`) + '\n')
}

async function hintElevationForPid(_pid: number): Promise<void> {
  if (process.platform === 'win32') {
    const isAdmin = await isWindowsAdmin()
    const msg = isAdmin
      ? 'Access denied (even as Administrator). The process may be protected or owned by another security context.'
      : 'Access denied. Try running in an elevated terminal (Run as Administrator).'
    process.stderr.write(lineInfo(msg) + '\n')
    return
  }

  process.stderr.write(lineInfo('Permission denied. Try re-running with sudo.') + '\n')
}

function maxLen(values: string[]): number {
  return values.reduce((m, v) => Math.max(m, v.length), 0)
}

main().catch((err: any) => {
  const msg = err?.message ? String(err.message) : String(err)
  process.stderr.write(lineErr(msg) + '\n')
  process.exitCode = 1
})