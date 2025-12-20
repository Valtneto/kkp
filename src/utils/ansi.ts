const ESC = '\u001B['

export const ansi = {
  /** Clear the entire screen */
  clearScreen: `${ESC}2J`,
  /** Clear from cursor to end of screen */
  clearDown: `${ESC}J`,
  /** Clear the current line */
  clearLine: `${ESC}2K`,

  hideCursor: `${ESC}?25l`,
  showCursor: `${ESC}?25h`,

  /** Enable the terminal's alternate screen buffer */
  altScreenEnter: `${ESC}?1049h`,
  /** Restore the main screen buffer */
  altScreenExit: `${ESC}?1049l`,

  /** Reset all styles */
  reset: `${ESC}0m`,
} as const

export function cursorTo(x: number, y: number): string {
  // 1-indexed
  return `${ESC}${y + 1};${x + 1}H`
}

export function cursorUp(n = 1): string {
  return `${ESC}${n}A`
}

export function cursorDown(n = 1): string {
  return `${ESC}${n}B`
}

export function cursorForward(n = 1): string {
  return `${ESC}${n}C`
}

export function cursorBack(n = 1): string {
  return `${ESC}${n}D`
}