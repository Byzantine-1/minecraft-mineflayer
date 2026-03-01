const test = require('node:test')
const assert = require('node:assert/strict')

const { buildEmbodimentRequest } = require('../../src/embodiment/contract')
const { MineflayerEmbodimentAdapter } = require('../../src/embodiment/mineflayerAdapter')
const { createFakeBot } = require('../helpers/fakeBot')

test('MineflayerEmbodimentAdapter applies stable body actions and emits structured completion', { timeout: 1000 }, async () => {
  const bot = createFakeBot({
    username: 'mara',
    autoSpawn: false
  })
  bot.entities[7] = {
    id: 7,
    username: 'cleric',
    position: { x: 3, y: 64, z: 4 }
  }

  const events = []
  const runtime = {
    resolveBotRecord(botName) {
      if (botName === 'mara') {
        return { bot }
      }
      return null
    },
    sendChat(botName, message) {
      if (botName !== 'mara') {
        return false
      }
      bot.chat(message)
      return true
    },
    log() {}
  }

  const adapter = new MineflayerEmbodimentAdapter({
    runtime,
    emitEvent: (event) => events.push(event),
    setTimeoutFn: (fn) => {
      fn()
      return 1
    }
  })

  const request = buildEmbodimentRequest({
    type: 'execution-result.v1',
    executionId: 'exec-21',
    status: 'accepted',
    actorId: 'mara',
    embodiment: {
      actions: [
        { type: 'speech.say', text: 'Stand ready.' },
        {
          type: 'movement.intent',
          mode: 'approach',
          target: { x: 8, y: 64, z: 12, radius: 1 }
        },
        {
          type: 'interaction.intent',
          interaction: 'use_entity',
          target: { entityId: '7' }
        },
        {
          type: 'ambient.perform',
          gesture: 'jump',
          style: 'ceremonial',
          durationMs: 300
        }
      ]
    }
  })

  const result = await adapter.applyRequest(request)

  assert.equal(result.status, 'applied')
  assert.equal(bot.chats[0], 'Stand ready.')
  assert.equal(bot.pathfinder.goals.length, 1)
  assert.equal(bot.pathfinder.goals[0].goal.constructor.name, 'GoalNear')
  assert.deepEqual(bot.activateEntityCalls, [7])
  assert.deepEqual(bot.controlStates, [
    { control: 'jump', value: true },
    { control: 'jump', value: false }
  ])
  assert.equal(events.filter((event) => event.event === 'action.applied').length, 4)

  const completion = events.find((event) => event.event === 'request.completed')
  assert.equal(completion.status, 'applied')
  assert.deepEqual(completion.summary, {
    applied: 4,
    ignored: 0,
    failed: 0
  })
})

test('MineflayerEmbodimentAdapter ignores non-accepted requests without making bot decisions', { timeout: 1000 }, async () => {
  const bot = createFakeBot({
    username: 'mara',
    autoSpawn: false
  })

  const runtime = {
    resolveBotRecord() {
      return { bot }
    },
    sendChat() {
      bot.chat('should-not-send')
      return true
    },
    log() {}
  }

  const adapter = new MineflayerEmbodimentAdapter({
    runtime,
    setTimeoutFn: (fn) => {
      fn()
      return 1
    }
  })

  const request = buildEmbodimentRequest({
    type: 'execution-result.v1',
    executionId: 'exec-22',
    status: 'rejected',
    actorId: 'mara',
    embodiment: {
      actions: [
        { type: 'speech.say', text: 'This should not be embodied.' }
      ]
    }
  })

  const result = await adapter.applyRequest(request)

  assert.equal(result.status, 'ignored')
  assert.deepEqual(bot.chats, [])
  assert.deepEqual(result.summary, {
    applied: 0,
    ignored: 0,
    failed: 0
  })
})
