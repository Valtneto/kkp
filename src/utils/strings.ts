const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '')
}

export function stringWidth(input: string): number {
  // This is intentionally lightweight. Most of our UI is ASCII (ports, pids, proto).
  // If you need perfect Unicode column widths, plug in a wcwidth implementation.
  return Array.from(stripAnsi(input)).length
}

export function padRight(input: string, width: number): string {
  const w = stringWidth(input)
  if (w >= width) return input
  return input + ' '.repeat(width - w)
}

export function padLeft(input: string, width: number): string {
  const w = stringWidth(input)
  if (w >= width) return input
  return ' '.repeat(width - w) + input
}

export function truncate(input: string, width: number): string {
  if (width <= 0) return ''
  const s = stripAnsi(input)
  if (stringWidth(s) <= width) return s
  return Array.from(s).slice(0, Math.max(0, width - 1)).join('') + '…'
}

export function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    const k = key(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}