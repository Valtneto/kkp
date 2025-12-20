import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: false,
  minify: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
})