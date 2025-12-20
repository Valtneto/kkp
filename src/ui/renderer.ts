import pc from 'picocolors'

import type { Listener, Protocol } from '../core/types'
import { padRight, truncate } from '../utils/strings'
import { symbols } from '../utils/symbols'

export const sym = symbols

export function fmtPort(port: number): string {
  return pc.bold(pc.cyan(String(port)))
}

export function fmtProto(proto: Protocol): string {
  return pc.magenta(proto)
}

export function fmtPid(pid: number): string {
  return pc.dim(`#${pid}`)
}

export function fmtUser(user?: string): string {
  if (!user) return pc.dim('—')
  return pc.dim(user)
}

export function fmtAddr(addr?: string): string {
  if (!addr) return pc.dim('—')
  return pc.dim(addr)
}

export function fmtCmd(cmd?: string): string {
  if (!cmd) return pc.dim('—')
  return pc.dim(cmd)
}

export function lineOk(text: string): string {
  return pc.green(text)
}

export function lineErr(text: string): string {
  return pc.red(text)
}

export function lineInfo(text: string): string {
  return pc.dim(`${sym.info} ${text}`)
}

export function formatKillLine(l: Listener): string {
  // Example: 3000 tcp #1234 (node)
  const port = fmtPort(l.port)
  const proto = fmtProto(l.protocol)
  const pid = fmtPid(l.pid)
  const name = l.processName ? pc.dim(`(${l.processName})`) : ''
  return `${port} ${proto} ${pid} ${name}`.trimEnd()
}

export function formatListenerRow(
  l: Listener,
  widths: { portW: number; pidW: number; userW: number; addrW: number },
): string {
  const port = padRight(String(l.port), widths.portW)
  const proto = padRight(l.protocol, 3)
  const pid = padRight(String(l.pid), widths.pidW)
  
  // Simplified: only show process name, skip user/addr for cleaner output
  const name = l.processName ?? l.command ?? ''
  const displayName = truncate(name, 32)

  return [
    pc.bold(pc.cyan(port)),
    pc.magenta(proto),
    pc.dim(`#${pid}`),
    pc.dim(displayName),
  ].join(' ')
}

export function formatListenerRowVerbose(
  l: Listener,
  widths: { portW: number; pidW: number; userW: number; addrW: number },
): string {
  const port = padRight(String(l.port), widths.portW)
  const proto = padRight(l.protocol, 3)
  const pid = padRight(String(l.pid), widths.pidW)
  const user = padRight(truncate(l.user ?? symbols.dash, widths.userW), widths.userW)
  const addr = padRight(truncate(l.localAddress ?? symbols.dash, widths.addrW), widths.addrW)

  // Command should take the rest; we only truncate a bit to keep lines tidy.
  const cmd = truncate(l.command ?? l.processName ?? symbols.dash, 64)

  return [
    pc.bold(pc.cyan(port)),
    pc.magenta(proto),
    pc.dim(`#${pid}`),
    pc.dim(user),
    pc.dim(addr),
    pc.dim(cmd),
  ].join(' ')
}