const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseEngineStdoutLine,
  shouldForwardEngineLine
} = require('../../src/bridgeRuntime')

function createSeededRng(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x100000000
  }
}

function randomAsciiString(rng, maxLen = 80) {
  const len = Math.floor(rng() * maxLen)
  let out = ''
  for (let i = 0; i < len; i += 1) {
    const code = 32 + Math.floor(rng() * 95)
    out += String.fromCharCode(code)
  }
  return out
}

test('parseEngineStdoutLine parses canonical dialogue lines', { timeout: 1000 }, () => {
  assert.deepEqual(parseEngineStdoutLine('Mara: We all know what you did.'), {
    speaker: 'Mara',
    message: 'We all know what you did.'
  })
})

test('parseEngineStdoutLine parses prompt-style prefixed lines', { timeout: 1000 }, () => {
  assert.deepEqual(parseEngineStdoutLine('> Mara: hello'), {
    speaker: 'Mara',
    message: 'hello'
  })
})

test('engine stdout parsing ignores noise, empties, and partials', { timeout: 1000 }, () => {
  assert.equal(parseEngineStdoutLine(''), null)
  assert.equal(parseEngineStdoutLine('Commands:'), null)
  assert.equal(parseEngineStdoutLine('Mara:'), null)
  assert.equal(shouldForwardEngineLine('>'), false)
  assert.equal(shouldForwardEngineLine('--- WORLD ONLINE ---'), false)
})

test('engine stdout parser is robust under deterministic fuzz input', { timeout: 2000 }, () => {
  const rng = createSeededRng(1337)
  for (let i = 0; i < 1200; i += 1) {
    const candidate = randomAsciiString(rng, 120)
    const parsed = parseEngineStdoutLine(candidate)
    if (!parsed) {
      continue
    }
    assert.equal(typeof parsed.speaker, 'string')
    assert.equal(typeof parsed.message, 'string')
    assert.ok(parsed.speaker.length > 0)
    assert.ok(parsed.message.length > 0)
    assert.equal(shouldForwardEngineLine(candidate), true)
  }
})
