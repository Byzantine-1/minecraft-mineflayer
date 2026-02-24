const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { waitFor } = require('../helpers/waitFor')

function stateFile(stateDir, fileName) {
  return path.join(stateDir, fileName)
}

test('engine_proxy ignores governance commands and does not write shadow state while forwarding talk', { timeout: 8000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-proxy-guard-'))
  const capturePath = path.join(tempDir, 'engine-capture.log')
  const stateDir = path.join(tempDir, 'state')

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: path.resolve(__dirname, '../../scripts/fakeEngine.js'),
      ENGINE_CWD: path.resolve(__dirname, '../..'),
      BOT_NAMES: 'mara',
      CHAT_PREFIX: '!',
      STATE_DIR: stateDir,
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

    maraBot.emit('chat', 'Tester', '!all council permit expedition forbidden-in-proxy')
    maraBot.emit('chat', 'Tester', '!all event famine 80')
    maraBot.emit('chat', 'Tester', '!mara hello')

    await waitFor(
      () => maraBot.chats.some((line) => line.includes('hello')),
      4000
    )

    const captured = fs.readFileSync(capturePath, 'utf8')
    assert.match(captured, /talk mara hello/)
    assert.doesNotMatch(captured, /council permit expedition/)
    assert.doesNotMatch(captured, /event famine/)

    assert.equal(fs.existsSync(stateFile(stateDir, 'settlement.json')), false)
    assert.equal(fs.existsSync(stateFile(stateDir, 'roster.json')), false)
    assert.equal(fs.existsSync(stateFile(stateDir, 'logbook.jsonl')), false)
  } finally {
    runtime.shutdown('proxy-governance-guard')
  }
})
