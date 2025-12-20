import type { FindOptions, Listener, Protocol } from '../types'
import { platform } from '../../utils/platform'

export interface Finder {
  /** List all listening sockets/endpoints (best-effort). */
  listAll(): Promise<Listener[]>
  /** Find listeners bound to a specific port. */
  findByPort(port: number, options: FindOptions): Promise<Listener[]>
}

export async function getFinder(): Promise<Finder> {
  const p = platform()
  if (p === 'linux') {
    const mod = await import('./linux')
    return new mod.LinuxFinder()
  }
  if (p === 'darwin') {
    const mod = await import('./darwin')
    return new mod.DarwinFinder()
  }
  if (p === 'win32') {
    const mod = await import('./windows')
    return new mod.WindowsFinder()
  }

  // Best-effort fallback: treat as POSIX-like and try lsof.
  const mod = await import('./posixFallback')
  return new mod.PosixFallbackFinder()
}

export const DEFAULT_PROTOCOLS: Protocol[] = ['tcp', 'udp']