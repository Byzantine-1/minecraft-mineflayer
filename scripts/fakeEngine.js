const fs = require('fs')
const readline = require('readline')

const CAPTURE_FILE = process.env.FAKE_ENGINE_CAPTURE_FILE || ''
const EMIT_NOISE = String(process.env.FAKE_ENGINE_NOISE || '1') !== '0'

function appendCapture(line) {
  if (!CAPTURE_FILE) {
    return
  }
  fs.appendFileSync(CAPTURE_FILE, `${line}\n`, 'utf8')
}

function toSpeaker(target) {
  const lower = String(target || '').toLowerCase()
  if (!lower) {
    return 'Agent'
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

if (EMIT_NOISE) {
  console.log('--- WORLD ONLINE ---')
  console.log('Commands:')
  console.log('>')
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

rl.on('line', (line) => {
  const trimmed = String(line || '').trim()
  if (!trimmed) {
    return
  }

  appendCapture(trimmed)

  if (trimmed === 'exit') {
    console.log('World saved. Exiting.')
    setTimeout(() => process.exit(0), 25)
    return
  }

  if (trimmed.startsWith('talk ')) {
    const payload = trimmed.slice(5).trim()
    const firstSpace = payload.indexOf(' ')
    if (firstSpace <= 0) {
      console.log('INVALID TALK')
      return
    }
    const target = payload.slice(0, firstSpace).trim()
    const message = payload.slice(firstSpace + 1).trim()
    console.log(`${toSpeaker(target)}: ${message}`)
    if (EMIT_NOISE) {
      console.log('>')
    }
    return
  }

  if (trimmed.startsWith('god ')) {
    console.log(`GOD COMMAND APPLIED: ${trimmed.slice(4).trim()}`)
    return
  }

  console.log(`NOOP: ${trimmed}`)
})
