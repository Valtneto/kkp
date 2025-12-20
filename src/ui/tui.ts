import pc from 'picocolors'

import type { Listener } from '../core/types'
import { ansi, cursorTo } from '../utils/ansi'
import { stringWidth, truncate, uniqBy } from '../utils/strings'
import { symbols } from '../utils/symbols'
import { formatListenerRow } from './renderer'

export interface TuiSelectResult {
  cancelled: boolean
  selected: Listener[]
}

const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  pageUp: '\u001B[5~',
  pageDown: '\u001B[6~',
  home: '\u001B[H',
  end: '\u001B[F',
} as const

function isCtrlC(buf: Buffer): boolean {
  return buf.length === 1 && buf[0] === 3
}

function isEsc(buf: Buffer): boolean {
  return buf.length === 1 && buf[0] === 27
}

function isEnter(buf: Buffer): boolean {
  return buf.length === 1 && (buf[0] === 10 || buf[0] === 13)
}

function isSpace(buf: Buffer): boolean {
  return buf.length === 1 && buf[0] === 32
}

function isChar(buf: Buffer, ch: string): boolean {
  return buf.toString('utf8') === ch
}

function asKey(buf: Buffer): string {
  return buf.toString('utf8')
}

export async function selectListeners(listeners: Listener[]): Promise<TuiSelectResult> {
  // Dedupe by pid+port+proto (netstat/ss can report duplicates).
  const items = uniqBy(listeners, (l) => `${l.protocol}:${l.port}:${l.pid}:${l.localAddress ?? ''}`)
  items.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.pid - b.pid)

  const stdin = process.stdin
  const stdout = process.stdout

  const isTTY = Boolean(stdin.isTTY && stdout.isTTY)
  if (!isTTY) return { cancelled: true, selected: [] }

  const state = {
    index: 0,
    top: 0,
    selected: new Set<number>(),
    width: stdout.columns || 80,
    height: stdout.rows || 24,
    done: false,
  }

  let resolveResult: ((r: TuiSelectResult) => void) | null = null
  const resultPromise = new Promise<TuiSelectResult>((resolve) => {
    resolveResult = resolve
  })


  const restore = () => {
    try {
      stdout.write(ansi.showCursor)
      stdout.write(ansi.altScreenExit)
    } catch {
      // ignore
    }
    try {
      stdin.setRawMode?.(false)
    } catch {
      // ignore
    }
    stdin.pause()
    stdin.removeListener('data', onData)
    process.off('SIGINT', onSigInt)
  }

  const done = (r: TuiSelectResult) => {
    if (state.done) return
    state.done = true
    restore()
    resolveResult?.(r)
  }

  const onSigInt = () => {
    process.exitCode = 130
    done({ cancelled: true, selected: [] })
  }

  const onData = (data: Buffer) => {
    if (state.done) return

    if (isCtrlC(data)) {
      process.exitCode = 130
      done({ cancelled: true, selected: [] })
      return
    }

    if (isEsc(data)) {
      done({ cancelled: true, selected: [] })
      return
    }

    if (isEnter(data)) {
      const selected = items.filter((_, idx) => state.selected.has(idx))
      done({ cancelled: false, selected })
      return
    }

    if (isSpace(data)) {
      toggleSelected(state.index)
      render()
      return
    }

    // Vim-ish
    if (isChar(data, 'j')) {
      move(1)
      render()
      return
    }
    if (isChar(data, 'k')) {
      move(-1)
      render()
      return
    }

    const key = asKey(data)
    if (key === KEY.up) {
      move(-1)
      render()
      return
    }
    if (key === KEY.down) {
      move(1)
      render()
      return
    }
    if (key === KEY.pageUp) {
      move(-(visibleRows()))
      render()
      return
    }
    if (key === KEY.pageDown) {
      move(visibleRows())
      render()
      return
    }
    if (key === KEY.home) {
      state.index = 0
      state.top = 0
      render()
      return
    }
    if (key === KEY.end) {
      state.index = items.length - 1
      state.top = Math.max(0, items.length - visibleRows())
      render()
      return
    }
  }

  const visibleRows = (): number => {
    // Reserve 2 lines for the subtle footer.
    return Math.max(1, (stdout.rows || 24) - 2)
  }

  const move = (delta: number) => {
    const next = clamp(state.index + delta, 0, items.length - 1)
    state.index = next

    const rows = visibleRows()
    if (state.index < state.top) state.top = state.index
    if (state.index >= state.top + rows) state.top = state.index - rows + 1
  }

  const toggleSelected = (idx: number) => {
    if (state.selected.has(idx)) state.selected.delete(idx)
    else state.selected.add(idx)
  }

  const computeWidths = () => {
    const portW = Math.max(4, maxLen(items.map((l) => String(l.port))))
    const pidW = Math.max(4, maxLen(items.map((l) => String(l.pid))))
    const userW = Math.min(18, Math.max(4, maxLen(items.map((l) => l.user ?? ''))))
    const addrW = Math.min(26, Math.max(3, maxLen(items.map((l) => l.localAddress ?? ''))))
    return { portW, pidW, userW, addrW }
  }


  const render = () => {
    state.width = stdout.columns || 80
    state.height = stdout.rows || 24

    const rows = visibleRows()
    const w = computeWidths()

    stdout.write(cursorTo(0, 0))
    stdout.write(ansi.clearScreen)

    const slice = items.slice(state.top, state.top + rows)

    for (let i = 0; i < slice.length; i++) {
      const absoluteIdx = state.top + i
      const isActive = absoluteIdx === state.index
      const isSelected = state.selected.has(absoluteIdx)

      const caret = isActive ? pc.cyan(symbols.step) : pc.dim(' ')
      const box = isSelected ? pc.green(`[${symbols.ok}]`) : pc.dim('[ ]')

      // Row rendering
      const row = formatListenerRow(slice[i]!, w)

      // Ensure the line doesn't overflow terminal width.
      const prefix = `${caret} ${box} `
      const max = Math.max(10, state.width - stringWidth(prefix))
      const clipped = truncate(row, max)

      stdout.write(prefix + clipped + '\n')
    }

    // Footer: single, calm line.
    const footer = [
      pc.dim('Space'),
      pc.dim('select'),
      pc.dim('·'),
      pc.dim('Enter'),
      pc.dim('kill'),
      pc.dim('·'),
      pc.dim('Esc'),
      pc.dim('exit'),
      pc.dim('·'),
      pc.dim('j/k'),
      pc.dim('move'),
    ].join(' ')
    stdout.write(pc.dim(footer) + '\n')
  }

  // Init terminal state
  stdout.write(ansi.altScreenEnter)
  stdout.write(ansi.hideCursor)
  stdout.write(ansi.clearScreen)

  stdin.resume()
  stdin.setRawMode?.(true)
  stdin.on('data', onData)
  process.on('SIGINT', onSigInt)

  render()
  return resultPromise
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function maxLen(values: string[]): number {
  return values.reduce((m, v) => Math.max(m, v.length), 0)
}