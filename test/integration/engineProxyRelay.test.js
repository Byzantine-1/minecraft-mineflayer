const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { waitFor } = require('../helpers/waitFor')

test('engine_proxy relays talk lines and maps engine stdout back to bot chat', { timeout: 8000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-proxy-relay-'))
  const capturePath = path.join(tempDir, 'engine-capture.log')

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: path.resolve(__dirname, '../../scripts/fakeEngine.js'),
      ENGINE_CWD: path.resolve(__dirname, '../..'),
      BOT_NAMES: 'mara,eli',
      CHAT_PREFIX: '!',
      FAKE_ENGINE_CAPTURE_FILE: capturePath,
      FAKE_ENGINE_NOISE: '1'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    attachStdin: false,
    chatMinIntervalMs: 0,
    logFn: () => {}
  })

  try {
    runtime.startFromEnv()

    const maraBot = runtime.resolveBotRecord('mara').bot
    const eliBot = runtime.resolveBotRecord('eli').bot

    maraBot.emit('chat', 'Tester', '!mara hello')
    eliBot.emit('chat', 'Tester', '!eli test')
    maraBot.emit('chat', 'Tester', 'mara should-not-forward')

    await waitFor(
      () =>
        maraBot.chats.some((line) => line.includes('hello')) &&
        eliBot.chats.some((line) => line.includes('test')),
      4000
    )

    const captured = fs.readFileSync(capturePath, 'utf8')
    assert.match(captured, /talk mara hello/)
    assert.match(captured, /talk eli test/)
    assert.doesNotMatch(captured, /should-not-forward/)

    runtime.shutdown('integration')
    await waitFor(() => fs.readFileSync(capturePath, 'utf8').includes('exit'), 3000)
  } finally {
    runtime.shutdown('integration-finally')
  }
})
