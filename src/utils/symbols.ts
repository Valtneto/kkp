/**
 * Terminal symbols - pure ASCII for maximum compatibility.
 */

export const symbols = {
  ok: '+',
  err: 'x',
  info: 'i',
  step: '>',
  bullet: '*',
  dash: '-',
} as const

// Spinner frames - ASCII only
export const spinnerFrames = ['-', '\\', '|', '/']