export type Platform = 'win32' | 'darwin' | 'linux' | 'other'

export function platform(): Platform {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'linux') return 'linux'
  return 'other'
}

export function isRoot(): boolean {
  // `process.getuid` only exists on POSIX
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof process.getuid === 'function') return process.getuid() === 0
  return false
}