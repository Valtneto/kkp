import type { FindOptions, Listener, Protocol } from '../types'
import { execFile, isCommandNotFound } from '../../utils/exec'
import { uniqBy } from '../../utils/strings'

export class DarwinFinder {
  async listAll(): Promise<Listener[]> {
    const out: Listener[] = []

    const tcp = await this.runLsof(['-nP', '-iTCP', '-sTCP:LISTEN'])
    out.push(...parseLsof(tcp, 'lsof'))

    const udp = await this.runLsof(['-nP', '-iUDP'])
    out.push(...parseLsof(udp, 'lsof'))

    return uniqBy(out, (l) => `${l.protocol}:${l.port}:${l.pid}:${l.localAddress ?? ''}`)
  }

  async findByPort(port: number, options: FindOptions): Promise<Listener[]> {
    const out: Listener[] = []

    if (options.protocols.includes('tcp')) {
      const tcp = await this.runLsof(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
      out.push(...parseLsof(tcp, 'lsof'))
    }

    if (options.protocols.includes('udp')) {
      const udp = await this.runLsof(['-nP', `-iUDP:${port}`])
      out.push(...parseLsof(udp, 'lsof'))
    }

    return uniqBy(out, (l) => `${l.protocol}:${l.port}:${l.pid}:${l.localAddress ?? ''}`)
  }

  private async runLsof(args: string[]): Promise<string> {
    try {
      const res = await execFile('lsof', args)
      return res.stdout
    } catch (err) {
      if (isCommandNotFound(err)) {
        throw new Error('lsof not found. Install lsof or use a different strategy.')
      }
      throw err
    }
  }
}

function parseLsof(stdout: string, source: string): Listener[] {
  const lines = stdout.split(/\r?\n/)
  const out: Listener[] = []
  let sawHeader = false

  for (const line of lines) {
    if (!line.trim()) continue
    if (!sawHeader) {
      if (line.toLowerCase().startsWith('command')) sawHeader = true
      continue
    }

    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue

    const cmd = parts[0]!
    const pid = parseInt(parts[1]!, 10)
    const user = parts[2]!
    const name = parts.slice(8).join(' ')

    const proto: Protocol | null = name.startsWith('TCP') ? 'tcp' : name.startsWith('UDP') ? 'udp' : null
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