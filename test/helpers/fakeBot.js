const { EventEmitter } = require('events')

function createFakeBot(config = {}) {
  const bot = new EventEmitter()
  bot.username = config.username || 'bot'
  bot.chats = []
  bot.quitCalls = []
  bot.lookAtCalls = []
  bot.lookCalls = []
  bot.controlStates = []
  bot.controlStateSnapshot = {}
  bot.swingArmCalls = []
  bot.activateItemCalls = 0
  bot.activateEntityCalls = []
  bot.activateBlockCalls = []
  bot.entities = {}
  bot.entity = { position: { x: 0, y: 64, z: 0 } }
  bot.time = { day: 1, timeOfDay: 6000 }
  bot.registry = { blocksByName: {} }
  bot.inventory = { items: () => [] }
  bot.pathfinder = {
    movements: null,
    goals: [],
    setMovements(movements) {
      bot.pathfinder.movements = movements
    },
    setGoal(goal, dynamic = false) {
      bot.pathfinder.goals.push({ goal, dynamic })
    }
  }

  bot.chat = (message) => {
    bot.chats.push(String(message))
  }

  bot.quit = (reason) => {
    bot.quitCalls.push(reason)
    bot.emit('end')
  }

  bot.loadPlugin = () => {}

  bot.lookAt = async (target) => {
    bot.lookAtCalls.push(target)
  }

  bot.look = async (yaw, pitch, force) => {
    bot.lookCalls.push({ yaw, pitch, force: !!force })
  }

  bot.setControlState = (control, value) => {
    bot.controlStates.push({ control, value: !!value })
    bot.controlStateSnapshot[control] = !!value
  }

  bot.clearControlStates = () => {
    bot.controlStates.push({ control: 'all', value: false })
    bot.controlStateSnapshot = {}
  }

  bot.swingArm = async (hand = 'right') => {
    bot.swingArmCalls.push(hand)
  }

  bot.activateItem = async () => {
    bot.activateItemCalls += 1
  }

  bot.activateEntity = async (entity) => {
    bot.activateEntityCalls.push(entity?.id ?? entity?.entityId ?? null)
  }

  bot.blockAt = (position) => ({
    position: {
      x: Number(position?.x) || 0,
      y: Number(position?.y) || 0,
      z: Number(position?.z) || 0
    }
  })

  bot.activateBlock = async (block) => {
    bot.activateBlockCalls.push(block)
  }

  if (config.autoSpawn !== false) {
    setImmediate(() => bot.emit('spawn'))
  }

  return bot
}

module.exports = {
  createFakeBot
}
