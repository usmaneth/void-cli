/**
 * Void CLI boot animation — prints a brief animated portal to stdout
 * before the Ink app renders. Pure console output, no React dependency.
 */

const PURPLE = '\x1b[38;2;139;92;246m'  // #8B5CF6
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CLEAR_LINE = '\x1b[2K'
const CURSOR_UP = (n: number) => `\x1b[${n}A`
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'

const PORTAL_FRAMES = [
  ['         ·         '],
  ['       · · ·       ', '      ·     ·      ', '       · · ·       '],
  ['      ░░░░░░░      ', '    ░░       ░░    ', '   ░░         ░░   ', '    ░░       ░░    ', '      ░░░░░░░      '],
  ['     ░░░░░░░░░     ', '   ░░▒▒▒▒▒▒▒░░    ', '  ░░▒▒       ▒▒░░  ', ' ░░▒▒         ▒▒░░ ', '  ░░▒▒       ▒▒░░  ', '   ░░▒▒▒▒▒▒▒░░    ', '     ░░░░░░░░░     '],
  ['     ░░░░░░░░░░░     ', '   ░░▒▒▓▓▓▓▓▒▒░░    ', '  ░░▒▓▓█████▓▓▒░░   ', ' ░░▒▓██     ██▓▒░░  ', ' ░░▒▓█       █▓▒░░  ', ' ░░▒▓██     ██▓▒░░  ', '  ░░▒▓▓█████▓▓▒░░   ', '   ░░▒▒▓▓▓▓▓▒▒░░    ', '     ░░░░░░░░░░░     '],
]

const TITLE = 'V O I D'
const TAGLINE = 'the infinite agent'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function clearFrame(lineCount: number): void {
  if (lineCount > 0) {
    process.stdout.write(CURSOR_UP(lineCount))
    for (let i = 0; i < lineCount; i++) {
      process.stdout.write(CLEAR_LINE + '\n')
    }
    process.stdout.write(CURSOR_UP(lineCount))
  }
}

function writeFrame(lines: string[]): void {
  for (const line of lines) {
    process.stdout.write(`${PURPLE}${line}${RESET}\n`)
  }
}

/**
 * Run the Void boot animation. Returns after animation completes (~1.5s).
 * Skipped if stdout is not a TTY.
 */
export async function runVoidBootAnimation(): Promise<void> {
  if (!process.stdout.isTTY) return

  // Check env var to skip animation
  if (process.env.VOID_SKIP_BOOT === '1') return

  process.stdout.write(HIDE_CURSOR)
  process.stdout.write('\n')

  let prevLines = 0

  try {
    for (const frame of PORTAL_FRAMES) {
      clearFrame(prevLines)
      writeFrame(frame)
      prevLines = frame.length
      await sleep(180)
    }

    // Show title
    await sleep(200)
    process.stdout.write(`\n${PURPLE}${BOLD}       ${TITLE}${RESET}\n`)
    prevLines += 2

    // Show tagline
    await sleep(250)
    process.stdout.write(`${DIM}    ${TAGLINE}${RESET}\n`)
    prevLines += 1

    await sleep(400)

    // Clear the entire animation
    clearFrame(prevLines)
  } finally {
    process.stdout.write(SHOW_CURSOR)
  }
}
