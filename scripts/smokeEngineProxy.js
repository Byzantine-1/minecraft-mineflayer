const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BridgeRuntime } = require('../src/bridgeRuntime')
const { createFakeBot } = require('../test/helpers/fakeBot')
const { waitFor } = require('../test/helpers/waitFor')

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-smoke-proxy-'))
  const capturePath = path.join(tempDir, 'engine-capture.log')

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: path.resolve(__dirname, './fakeEngine.js'),
      ENGINE_CWD: path.resolve(__dirname, '..'),
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
    const mara = runtime.resolveBotRecord('mara').bot
    const eli = runtime.resolveBotRecord('eli').bot

    mara.emit('chat', 'smoke-user', '!mara hello')
    eli.emit('chat', 'smoke-user', '!eli test')

    await waitFor(
      () => mara.chats.some((line) => line.includes('hello')) && eli.chats.some((line) => line.includes('test')),
      4000
    )

    const captured = fs.readFileSync(capturePath, 'utf8')
    assert.match(captured, /talk mara hello/)
    assert.match(captured, /talk eli test/)

    runtime.shutdown('smoke')
    await waitFor(() => fs.readFileSync(capturePath, 'utf8').includes('exit'), 3000)
    console.log('PASS smokeEngineProxy')
  } finally {
    runtime.shutdown('smoke-final')
  }
}

main().catch((error) => {
  console.error('FAIL smokeEngineProxy')
  console.error(error)
  process.exit(1)
})
