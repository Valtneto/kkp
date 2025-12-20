import pc from 'picocolors'

import { defaultTimeoutMs } from './args'
import { version } from '../version'

export function printHelp(): void {
  const dim = pc.dim
  const bold = pc.bold

  const lines = [
    `${bold('kkp')} ${dim(`v${version}`)} — kill processes by port`,
    '',
    `${bold('Usage')}`,
    `  kkp <port> [port ...]   ${dim('kill by port')}`,
    `  kkp                     ${dim('interactive TUI')}`,
    `  kkp --list              ${dim('list listeners')}`,
    '',
    `${bold('Options')}`,
    `  -l, --list         ${dim('list listeners')}`,
    `  -j, --json         ${dim('JSON output (with --list)')}`,
    `  -f, --force        ${dim('kill protected processes')}`,
    `      --dry-run      ${dim('preview without killing')}`,
    `      --tcp/--udp    ${dim('filter by protocol')}`,
    `      --timeout <ms> ${dim(`grace period (default: ${defaultTimeoutMs()}ms)`)}`,
    `      --pid <pid>    ${dim('kill by PID directly')}`,
    `  -h, --help         ${dim('show help')}`,
    `  -v, --version      ${dim('show version')}`,
    '',
    `${bold('Examples')}`,
    `  kkp 3000           ${dim('kill process on port 3000')}`,
    `  kkp 3000 5173      ${dim('kill multiple ports')}`,
    `  kkp 3000/tcp       ${dim('TCP only')}`,
    `  kkp --list --json  ${dim('JSON output')}`,
  ]

  process.stdout.write(lines.join('\n') + '\n')
}