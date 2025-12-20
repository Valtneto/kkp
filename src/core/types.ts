export type Protocol = 'tcp' | 'udp'

export interface Listener {
  /** tcp | udp */
  protocol: Protocol

  /** 1..65535 */
  port: number

  /** Process id */
  pid: number

  /** Best-effort local address (e.g. 127.0.0.1, 0.0.0.0, [::]) */
  localAddress?: string

  /** Best-effort process name (e.g. node, python, nginx) */
  processName?: string

  /** Best-effort full command line */
  command?: string

  /** Best-effort user (login name / account) */
  user?: string

  /** Original raw line (debug / troubleshooting) */
  raw?: string

  /** Strategy identifier that produced this record */
  source?: string
}

export interface FindOptions {
  protocols: Protocol[]
}

export interface KillOptions {
  /** Overrides safety checks and enables stronger termination on some platforms. */
  force?: boolean
  /** Grace window before escalation (SIGKILL). */
  timeoutMs?: number
  /** Attempt to kill a process tree where supported. */
  tree?: boolean
}

export interface KillResult {
  pid: number
  ok: boolean
  method: string
  message?: string
  errorCode?: string
}