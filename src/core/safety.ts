import type { Listener } from './types'
import { platform } from '../utils/platform'

export interface Protection {
  protected: boolean
  reason?: string
}

const POSIX_PROTECTED_NAMES = [
  'systemd',
  'launchd',
  'init',
  'kernel_task',
  'kthreadd',
  'systemd-journald',
  'systemd-logind',
  'sshd',
]

const WINDOWS_PROTECTED_NAMES = [
  'system',
  'system idle process',
  'registry',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'winlogon.exe',
  'svchost.exe',
]

export function protectionFor(l: Listener): Protection {
  const p = platform()

  const name = (l.processName ?? l.command ?? '').toLowerCase()

  // Protect init/system PID.
  if (p !== 'win32' && l.pid <= 1) {
    return { protected: true, reason: 'pid 1 (system init)' }
  }

  // On Windows, protect the well-known system PIDs.
  if (p === 'win32' && (l.pid === 0 || l.pid === 4)) {
    return { protected: true, reason: 'system process' }
  }

  if (p === 'win32') {
    for (const n of WINDOWS_PROTECTED_NAMES) {
      if (name === n || name.endsWith('\\' + n)) {
        return { protected: true, reason: 'critical Windows process' }
      }
      if (name.includes(n)) {
        // Conservative: many critical processes appear exactly as these names, but some include paths.
        return { protected: true, reason: 'critical Windows process' }
      }
    }
  } else {
    for (const n of POSIX_PROTECTED_NAMES) {
      if (name === n) return { protected: true, reason: 'critical system process' }
      if (name.includes(n)) return { protected: true, reason: 'critical system process' }
    }
  }

  // Extra safety: if it looks like a remote access daemon on its default port.
  if (l.port === 22 && /sshd/.test(name)) {
    return { protected: true, reason: 'sshd (avoid locking yourself out)' }
  }

  return { protected: false }
}

export function refusalMessage(l: Listener, reason: string): string {
  return `refused to kill pid ${l.pid}${l.processName ? ` (${l.processName})` : ''}: ${reason}`
}