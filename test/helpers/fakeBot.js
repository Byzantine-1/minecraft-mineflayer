const { EventEmitter } = require('events')

function createFakeBot(config = {}) {
  const bot = new EventEmitter()
  bot.username = config.username || 'bot'
  bot.chats = []
  bot.quitCalls = []
  bot.entities = {}
  bot.entity = { position: { x: 0, y: 64, z: 0 } }
  bot.time = { day: 1, timeOfDay: 6000 }
  bot.registry = { blocksByName: {} }
  bot.inventory = { items: () => [] }
  bot.pathfinder = {
    setMovements() {},
    setGoal() {}
  }

  bot.chat = (message) => {
    bot.chats.push(String(message))
  }

  bot.quit = (reason) => {
    bot.quitCalls.push(reason)
    bot.emit('end')
  }

  bot.loadPlugin = () => {}

  if (config.autoSpawn !== false) {
    setImmediate(() => bot.emit('spawn'))
  }

  return bot
}

module.exports = {
  createFakeBot
}
