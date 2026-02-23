const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BridgeRuntime,
  createBackoffDelay,
  parseEngineStdoutLine
} = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')

function createSeededRng(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0x100000000
  }
}

function randomWord(rng, maxLen = 10) {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789_:-! '
  const len = 1 + Math.floor(rng() * maxLen)
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += letters[Math.floor(rng() * letters.length)]
  }
  return out.trim() || 'x'
}

test('deterministic chaos run preserves bridge invariants', { timeout: 12000 }, () => {
  const rng = createSeededRng(20260223)
  const starts = { count: 0 }
  const lines = []
  const session = {
    process: { killed: false },
    exitSent: false,
    sendLine(line) {
      lines.push(line)
      return !this.process.killed
    },
    sendExit() {
      if (!this.exitSent) {
        this.exitSent = true
        lines.push('exit')
      }
      return true
    },
    shutdown() {
      this.process.killed = true
    },
    isExitSent() {
      return this.exitSent
    }
  }

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: 'fake-engine.js',
      BOT_NAMES: 'mara,eli',
      CHAT_PREFIX: '!'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    startEngineProxyImpl: () => {
      starts.count += 1
      return session
    },
    attachStdin: false,
    chatMinIntervalMs: 0,
    logFn: () => {}
  })

  const unhandled = []
  const onUnhandled = (error) => {
    unhandled.push(error)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    runtime.startFromEnv()
    const mara = runtime.resolveBotRecord('mara').bot

    for (let i = 0; i < 1200; i += 1) {
      const roll = rng()

      if (roll < 0.2) {
        const target = rng() < 0.5 ? 'mara' : 'unknown'
        const msg = `!${target} ${randomWord(rng, 20)}`
        assert.doesNotThrow(() => mara.emit('chat', `player_${i}`, msg))
      } else if (roll < 0.4) {
        const maybeValid = rng() < 0.5
        const line = maybeValid
          ? `${rng() < 0.5 ? 'Mara' : 'Eli'}: ${randomWord(rng, 16)}`
          : randomWord(rng, 24)
        assert.doesNotThrow(() => runtime.handleEngineStdoutLine(line))
      } else if (roll < 0.55) {
        assert.doesNotThrow(() => runtime.ensureEngineProxyProcess())
      } else if (roll < 0.7) {
        const attempt = Math.floor(rng() * 8)
        const delay = createBackoffDelay(attempt, 25, 400, 17, rng)
        assert.ok(delay >= 0)
        assert.ok(delay <= 400)
      } else if (roll < 0.85) {
        const parsed = parseEngineStdoutLine(randomWord(rng, 30))
        if (parsed) {
          assert.equal(typeof parsed.speaker, 'string')
          assert.equal(typeof parsed.message, 'string')
          assert.ok(parsed.speaker.length > 0)
          assert.ok(parsed.message.length > 0)
        }
      } else if (roll < 0.92) {
        assert.doesNotThrow(() => runtime.shutdown(`chaos_${i}`))
      } else {
        assert.doesNotThrow(() => runtime.sendToEngine(`talk mara ${randomWord(rng, 14)}`))
      }
    }
  } finally {
    runtime.shutdown('chaos-final')
    process.removeListener('unhandledRejection', onUnhandled)
  }

  assert.equal(starts.count, 1)
  assert.equal(unhandled.length, 0)
  assert.ok(lines.length > 0)
})
