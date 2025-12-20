import { execFile, isCommandNotFound } from './exec'

/**
 * Best-effort admin/elevation check.
 *
 * We only call this when we already hit an Access Denied path, so we keep it
 * simple and defensive.
 */
export async function isWindowsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  // Prefer PowerShell since it works on modern Windows by default.
  const script =
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'

  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]

  try {
    const res = await execFile('powershell.exe', args, { timeoutMs: 1500 })
    return /^true/i.test(res.stdout.trim())
  } catch (err) {
    if (isCommandNotFound(err)) return false
    return false
  }
}