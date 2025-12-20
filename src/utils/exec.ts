import { spawn } from 'node:child_process'

export interface ExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** If provided, will be written to stdin and then stdin will be closed. */
  stdin?: string
}

export interface ExecResult {
  cmd: string
  args: string[]
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
}

export class ExecSpawnError extends Error {
  override name = 'ExecSpawnError'
  code?: string
  errno?: number
  syscall?: string

  constructor(message: string, props: Partial<ExecSpawnError>) {
    super(message)
    Object.assign(this, props)
  }
}

export class ExecTimeoutError extends Error {
  override name = 'ExecTimeoutError'
  constructor(public cmd: string, public timeoutMs: number) {
    super(`Command timed out after ${timeoutMs}ms: ${cmd}`)
  }
}

export async function execFile(cmd: string, args: string[] = [], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    let timedOut = false
    let timer: NodeJS.Timeout | undefined

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, options.timeoutMs)
      timer.unref?.()
    }

    child.stdout.on('data', (d) => stdout.push(Buffer.from(d)))
    child.stderr.on('data', (d) => stderr.push(Buffer.from(d)))


    child.on('error', (err: any) => {
      if (timer) clearTimeout(timer)

      const e = new ExecSpawnError(err?.message ?? 'spawn failed', {
        code: err?.code,
        errno: err?.errno,
        syscall: err?.syscall,
      })
      reject(e)
    })

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)

      if (timedOut) {
        reject(new ExecTimeoutError(cmd, options.timeoutMs ?? 0))
        return
      }

      resolve({
        cmd,
        args,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
        signal,
      })
    })

    if (options.stdin != null) {
      child.stdin.write(options.stdin)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })
}

export function isCommandNotFound(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as any).code === 'ENOENT')
}