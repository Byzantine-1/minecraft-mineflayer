const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { waitFor } = require('../helpers/waitFor')

test('engine_proxy maps execution-result.v1 lines through the embodiment seam into body actions', { timeout: 8000 }, async () => {
  const events = []
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: path.resolve(__dirname, '../../scripts/fakeEngine.js'),
      ENGINE_CWD: path.resolve(__dirname, '../..'),
      BOT_NAMES: 'mara',
      CHAT_PREFIX: '!',
      FAKE_ENGINE_NOISE: '0'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    attachStdin: false,
    chatMinIntervalMs: 0,
    emitEmbodimentEventFn: (event) => events.push(event),
    logFn: () => {}
  })

  try {
    runtime.startFromEnv()
    const maraBot = runtime.resolveBotRecord('mara').bot

    runtime.handleEngineStdoutLine(
      JSON.stringify({
        type: 'execution-result.v1',
        executionId: 'exec-99',
        status: 'accepted',
        actorId: 'mara',
        embodiment: {
          backendHint: 'mineflayer',
          actions: [
            {
              type: 'speech.say',
              text: 'Bell toll acknowledged.'
            },
            {
              type: 'ambient.perform',
              gesture: 'swing_arm',
              style: 'ceremonial'
            }
          ]
        }
      })
    )

    await waitFor(
      () =>
        maraBot.chats.includes('Bell toll acknowledged.') &&
        maraBot.swingArmCalls.length === 1 &&
        events.some((event) => event.event === 'request.completed'),
      4000
    )

    const completion = events.find((event) => event.event === 'request.completed')
    assert.equal(completion.status, 'applied')
    assert.deepEqual(completion.summary, {
      applied: 2,
      ignored: 0,
      failed: 0
    })
  } finally {
    runtime.shutdown('proxy-embodiment-relay')
  }
})
