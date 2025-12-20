import type { KillOptions, KillResult } from '../types'
import { execFile } from '../../utils/exec'

export class WindowsKiller {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      if (err && typeof err === 'object' && (err as any).code === 'ESRCH') return false
      return true
    }
  }

  async kill(pid: number, options: KillOptions): Promise<KillResult> {
    if (!this.isAlive(pid)) return { pid, ok: true, method: 'already-exited' }

    const baseArgs = ['/PID', String(pid), '/T']

    // Try gentle kill first
    const first = await runTaskkill(baseArgs)
    if (first.ok) return { pid, ok: true, method: 'taskkill' }

    // Auto-escalate to /F (most Windows processes need it)
    const forced = await runTaskkill([...baseArgs, '/F'])
    if (forced.ok) return { pid, ok: true, method: 'taskkill /F' }

    // If still failed and user didn't use --force, suggest it
    if (!options.force && forced.errorCode === 'EPERM') {
      return forced
    }

    return forced
  }
}

async function runTaskkill(args: string[]): Promise<KillResult> {
  try {
    const res = await execFile('taskkill', args, { timeoutMs: 5000 })
    const out = `${res.stdout}\n${res.stderr}`.trim()

    // Check for success patterns (works for both English and other locales)
    if (/SUCCESS|成功/i.test(out)) return { pid: parsePid(args), ok: true, method: 'taskkill' }
    if (/not found|找不到/i.test(out)) return { pid: parsePid(args), ok: true, method: 'already-exited' }
    if (/Access.+denied|拒绝访问/i.test(out)) return { pid: parsePid(args), ok: false, method: 'taskkill', message: 'access denied', errorCode: 'EPERM' }

    // Exit code 0 means success
    if (res.code === 0) return { pid: parsePid(args), ok: true, method: 'taskkill' }
    
    // Clean up garbled Chinese characters in error message
    const cleanMsg = out.replace(/[\u0000-\u001F]|[^\x00-\x7F]/g, '').trim() || 'failed'
    return { pid: parsePid(args), ok: false, method: 'taskkill', message: cleanMsg }
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : String(err)
    const cleanMsg = msg.replace(/[\u0000-\u001F]|[^\x00-\x7F]/g, '').trim() || 'failed'
    const code = err?.code ? String(err.code) : undefined
    return { pid: parsePid(args), ok: false, method: 'taskkill', message: cleanMsg, errorCode: code }
  }
}

function parsePid(args: string[]): number {
  const idx = args.findIndex((a) => a.toUpperCase() === '/PID')
  if (idx >= 0) {
    const n = parseInt(args[idx + 1] ?? '', 10)
    if (Number.isFinite(n)) return n
  }
  return -1
}