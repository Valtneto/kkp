import pc from 'picocolors'

import { ansi } from '../utils/ansi'
import { spinnerFrames } from '../utils/symbols'

const frames = spinnerFrames

export interface Spinner {
  update(text: string): void
  stop(): void
}

export function createSpinner(initialText: string): Spinner {
  let text = initialText
  let i = 0
  let timer: NodeJS.Timeout | undefined
  let active = false

  // Skip spinner entirely if not a TTY (e.g., piped output)
  const isTTY = process.stdout.isTTY

  const render = () => {
    if (!isTTY) return
    const frame = frames[i++ % frames.length]!
    process.stdout.write(`\r${ansi.clearLine}${pc.cyan(frame)} ${pc.dim(text)}`)
  }

  const start = () => {
    if (active || !isTTY) return
    active = true
    process.stdout.write(ansi.hideCursor)
    render()
    timer = setInterval(render, 80)
    timer.unref?.()
  }

  // Delay start so fast operations remain "zero-noise".
  const startDelay = setTimeout(start, 100)
  startDelay.unref?.()

  return {
    update(nextText) {
      text = nextText
    },
    stop() {
      clearTimeout(startDelay)
      if (!active) return
      active = false
      if (timer) clearInterval(timer)
      if (isTTY) {
        process.stdout.write(`\r${ansi.clearLine}`)
        process.stdout.write(ansi.showCursor)
      }
    },
  }
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const s = createSpinner(text)
  try {
    return await fn()
  } finally {
    s.stop()
  }
}