import type { KillOptions, KillResult } from '../types'
import { execFile } from '../../utils/exec'

export class PosixKiller {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      // ESRCH => doesn't exist
      if (err && typeof err === 'object' && (err as any).code === 'ESRCH') return false
      // EPERM => exists but we don't have permission
      return true
    }
  }

  async kill(pid: number, options: KillOptions): Promise<KillResult> {
    if (!this.isAlive(pid)) return { pid, ok: true, method: 'already-exited' }

    const timeoutMs = Math.max(0, options.timeoutMs ?? 0)
    const tree = options.tree === true

    if (tree) {
      // Best-effort: kill child processes first using `ps`.
      // If this fails, we still attempt to kill the parent.
      try {
        const children = await listDescendants(pid)
        // Kill children first
        for (const c of children.reverse()) {
          await this.killSingle(c, timeoutMs)
        }
      } catch {
        // ignore
      }
    }

    return this.killSingle(pid, timeoutMs)
  }

  private async killSingle(pid: number, timeoutMs: number): Promise<KillResult> {
    // 1) Try SIGTERM
    try {
      process.kill(pid, 'SIGTERM')
    } catch (err: any) {
      if (err?.code === 'ESRCH') return { pid, ok: true, method: 'already-exited' }
      return { pid, ok: false, method: 'SIGTERM', message: err?.message ?? 'SIGTERM failed', errorCode: err?.code }
    }

    // 2) Wait up to timeout
    if (timeoutMs > 0) {
      const ok = await waitForExit(pid, timeoutMs)
      if (ok) return { pid, ok: true, method: 'SIGTERM' }
    }

    // 3) Escalate SIGKILL
    try {
      process.kill(pid, 'SIGKILL')
    } catch (err: any) {
      if (err?.code === 'ESRCH') return { pid, ok: true, method: 'SIGTERM' }
      return { pid, ok: false, method: 'SIGKILL', message: err?.message ?? 'SIGKILL failed', errorCode: err?.code }
    }

    // 4) Wait a bit to confirm
    const ok = await waitForExit(pid, 200)
    return ok
      ? { pid, ok: true, method: 'SIGKILL' }
      : { pid, ok: false, method: 'SIGKILL', message: 'process still alive' }
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0)
      // still alive
    } catch (err: any) {
      if (err?.code === 'ESRCH') return true
      // EPERM => exists, treat as alive
    }
    await sleep(30)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function listDescendants(rootPid: number): Promise<number[]> {
  // Portable-ish: `ps -o pid= --ppid <pid>`
  // We'll BFS to avoid deep recursion.
  const seen = new Set<number>()
  const out: number[] = []
  const q: number[] = [rootPid]

  while (q.length) {
    const pid = q.shift()!
    if (seen.has(pid)) continue
    seen.add(pid)

    const children = await listChildren(pid)
    for (const c of children) {
      if (!seen.has(c)) {
        out.push(c)
        q.push(c)
      }
    }
  }

  // Remove rootPid from descendants list.
  return out.filter((p) => p !== rootPid)
}

async function listChildren(pid: number): Promise<number[]> {
  const res = await execFile('ps', ['-o', 'pid=', '--ppid', String(pid)], { timeoutMs: 1000 })
  const out: number[] = []
  for (const line of res.stdout.split(/\r?\n/)) {
    const n = parseInt(line.trim(), 10)
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}