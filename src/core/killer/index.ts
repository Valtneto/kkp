import type { KillOptions, KillResult } from '../types'
import { platform } from '../../utils/platform'

export interface Killer {
  kill(pid: number, options: KillOptions): Promise<KillResult>
  isAlive(pid: number): boolean
}

export async function getKiller(): Promise<Killer> {
  const p = platform()
  if (p === 'win32') {
    const mod = await import('./windows')
    return new mod.WindowsKiller()
  }
  const mod = await import('./posix')
  return new mod.PosixKiller()
}