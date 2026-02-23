let GoalNear = null
try {
  GoalNear = require('mineflayer-pathfinder').goals.GoalNear
} catch (error) {
  GoalNear = null
}

const HOSTILE_MOBS = new Set([
  'zombie',
  'zombie_villager',
  'husk',
  'drowned',
  'skeleton',
  'stray',
  'spider',
  'cave_spider',
  'creeper',
  'phantom',
  'witch',
  'pillager',
  'vindicator',
  'ravager',
  'slime',
  'magma_cube',
  'enderman'
])

const FOOD_KEYWORDS = ['bread', 'beef', 'pork', 'mutton', 'chicken', 'rabbit', 'potato', 'carrot', 'apple']

function abortError() {
  const error = new Error('Task aborted')
  error.name = 'AbortError'
  return error
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function randomInt(min, max) {
  const floorMin = Math.ceil(min)
  const floorMax = Math.floor(max)
  return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin
}

function isAborted(signal) {
  return !!signal?.aborted
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (isAborted(signal)) {
      reject(abortError())
      return
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))

    const onAbort = () => {
      clearTimeout(timeout)
      reject(abortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function createLinkedSignal(signals) {
  const controller = new AbortController()
  const cleanupFns = []

  for (const signal of signals) {
    if (!signal) {
      continue
    }

    if (signal.aborted) {
      controller.abort()
      break
    }

    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupFns.push(() => signal.removeEventListener('abort', onAbort))
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const cleanupFn of cleanupFns) {
        cleanupFn()
      }
    }
  }
}

async function withActionTimeout(timeoutMs, outerSignal, action) {
  const timeoutController = new AbortController()
  const timeoutHandle = setTimeout(() => timeoutController.abort(), Math.max(1000, timeoutMs))
  const linked = createLinkedSignal([outerSignal, timeoutController.signal])

  try {
    return await action(linked.signal)
  } finally {
    clearTimeout(timeoutHandle)
    linked.cleanup()
  }
}

function toSimplePos(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y)) &&
    Number.isFinite(Number(value.z))
  ) {
    return {
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z)
    }
  }

  return null
}

function getPosition(bot) {
  return toSimplePos(bot?.entity?.position)
}

function distance(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY
  }
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function toSimpleBlockPositions(blocks) {
  if (!Array.isArray(blocks)) {
    return []
  }
  return blocks
    .map((block) => toSimplePos(block))
    .filter(Boolean)
}

function blockIdsByName(bot, names) {
  const registry = bot?.registry?.blocksByName
  if (!registry) {
    return []
  }
  return names
    .map((name) => registry?.[name]?.id)
    .filter((id) => Number.isFinite(Number(id)))
}

function findBlocksSafe(bot, blockNames, maxDistance, count) {
  if (!bot || typeof bot.findBlocks !== 'function') {
    return []
  }

  const ids = blockIdsByName(bot, blockNames)
  if (ids.length === 0) {
    return []
  }

  try {
    return toSimpleBlockPositions(
      bot.findBlocks({
        matching: ids,
        maxDistance: Math.max(2, maxDistance),
        count: Math.max(1, count)
      })
    )
  } catch (error) {
    return []
  }
}

function isHostileEntity(entity) {
  if (!entity || entity.type !== 'mob') {
    return false
  }
  return HOSTILE_MOBS.has(String(entity.name || '').toLowerCase())
}

function boundedScan(bot, authoritySnapshot, options = {}) {
  const entityRadius = clamp(Number(options.entityRadius) || 24, 8, 40)
  const maxEntities = clamp(Number(options.maxEntities) || 24, 4, 48)
  const blockRadius = clamp(Number(options.blockRadius) || 20, 6, 40)
  const blockCount = clamp(Number(options.blockCount) || 20, 3, 40)
  const position = getPosition(bot)

  const nearbyPlayers = []
  const nearbyHostiles = []
  const nearbyFriendly = []

  const entities = Object.values(bot?.entities || {})
  for (const entity of entities) {
    if (!entity || entity === bot?.entity) {
      continue
    }
    const entityPos = toSimplePos(entity.position)
    if (!entityPos) {
      continue
    }

    const d = distance(position, entityPos)
    if (d > entityRadius) {
      continue
    }

    if (entity.type === 'player') {
      nearbyPlayers.push({
        username: entity.username || 'player',
        distance: Number(d.toFixed(1)),
        position: entityPos
      })
      continue
    }

    if (isHostileEntity(entity)) {
      nearbyHostiles.push({
        id: entity.id,
        name: entity.name,
        distance: Number(d.toFixed(1)),
        position: entityPos,
        type: entity.type
      })
      continue
    }

    nearbyFriendly.push({
      id: entity.id,
      name: entity.name,
      distance: Number(d.toFixed(1)),
      position: entityPos,
      type: entity.type
    })
  }

  nearbyPlayers.sort((a, b) => a.distance - b.distance)
  nearbyHostiles.sort((a, b) => a.distance - b.distance)
  nearbyFriendly.sort((a, b) => a.distance - b.distance)

  const logs = findBlocksSafe(
    bot,
    ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'],
    blockRadius,
    blockCount
  )
  const ores = findBlocksSafe(
    bot,
    ['coal_ore', 'iron_ore', 'copper_ore', 'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore'],
    blockRadius,
    blockCount
  )
  const crops = findBlocksSafe(
    bot,
    ['wheat', 'carrots', 'potatoes', 'beetroots'],
    blockRadius,
    blockCount
  )

  const taskDistances = {
    gatherFood: crops[0] ? distance(position, crops[0]) : 0,
    chopWood: logs[0] ? distance(position, logs[0]) : 0,
    mineOre: ores[0] ? distance(position, ores[0]) : 0,
    patrol: 8,
    healRest: 5,
    attendService: 10
  }

  return {
    at: new Date().toISOString(),
    position,
    timeOfDay: authoritySnapshot?.timeOfDay || 'day',
    nearbyPlayers: nearbyPlayers.slice(0, maxEntities),
    nearbyHostiles: nearbyHostiles.slice(0, maxEntities),
    nearbyFriendly: nearbyFriendly.slice(0, maxEntities),
    hostileMobCount: nearbyHostiles.length,
    nearbyFriendlyCount: nearbyFriendly.length,
    candidateBlocks: {
      logs: logs.slice(0, blockCount),
      ores: ores.slice(0, blockCount),
      crops: crops.slice(0, blockCount)
    },
    taskDistances
  }
}

async function safeMoveTo(bot, target, options = {}) {
  const range = clamp(Number(options.range) || 2, 1, 6)
  const timeoutMs = clamp(Number(options.timeoutMs) || 9000, 1500, 25000)
  const signal = options.signal

  if (isAborted(signal)) {
    throw abortError()
  }

  if (!GoalNear || !bot?.pathfinder || !target) {
    return {
      ok: false,
      note: 'pathfinder unavailable or no target'
    }
  }

  const simpleTarget = toSimplePos(target)
  if (!simpleTarget) {
    return {
      ok: false,
      note: 'invalid move target'
    }
  }

  const goal = new GoalNear(
    Math.floor(simpleTarget.x),
    Math.floor(simpleTarget.y),
    Math.floor(simpleTarget.z),
    range
  )

  bot.pathfinder.setGoal(goal)
  const start = Date.now()
  let arrived = false

  try {
    while (Date.now() - start < timeoutMs) {
      if (isAborted(signal)) {
        throw abortError()
      }

      const current = getPosition(bot)
      if (distance(current, simpleTarget) <= range + 0.8) {
        arrived = true
        break
      }

      await sleep(200, signal)
    }
  } finally {
    bot.pathfinder.setGoal(null)
  }

  return {
    ok: arrived,
    note: arrived ? 'arrived' : 'move timeout'
  }
}

function findFirstFoodItem(bot) {
  if (!bot?.inventory || typeof bot.inventory.items !== 'function') {
    return null
  }

  return bot.inventory.items().find((item) => {
    const name = String(item?.name || '').toLowerCase()
    return FOOD_KEYWORDS.some((keyword) => name.includes(keyword))
  }) || null
}

async function maybeEatFromInventory(bot, signal) {
  if (isAborted(signal)) {
    throw abortError()
  }

  const food = findFirstFoodItem(bot)
  if (!food) {
    return false
  }

  if (typeof bot.equip !== 'function' || typeof bot.consume !== 'function') {
    return false
  }

  try {
    await bot.equip(food, 'hand')
    await bot.consume()
    return true
  } catch (error) {
    return false
  }
}

async function attackNearestHostileMob(bot, hostiles, options = {}) {
  const allowCombat = !!options.allowCombat
  const signal = options.signal
  if (!allowCombat) {
    return { ok: false, note: 'combat disabled' }
  }

  const target = Array.isArray(hostiles) ? hostiles[0] : null
  if (!target) {
    return { ok: false, note: 'no hostile target' }
  }

  if (target.type === 'player') {
    return { ok: false, note: 'player targeting blocked' }
  }

  await safeMoveTo(bot, target.position, {
    range: 2,
    timeoutMs: 7000,
    signal
  })

  if (isAborted(signal)) {
    throw abortError()
  }

  if (typeof bot.attack !== 'function') {
    return { ok: false, note: 'attack primitive unavailable' }
  }

  try {
    const entity = bot.entities?.[target.id]
    if (!entity || entity.type === 'player') {
      return { ok: false, note: 'target unavailable or invalid' }
    }
    await bot.attack(entity)
    return { ok: true, note: `engaged ${target.name}` }
  } catch (error) {
    return { ok: false, note: 'attack failed' }
  }
}

function say(bot, text) {
  if (!bot || typeof bot.chat !== 'function') {
    return
  }
  const message = String(text || '').slice(0, 240)
  if (message.trim().length > 0) {
    bot.chat(message)
  }
}

module.exports = {
  clamp,
  randomInt,
  sleep,
  withActionTimeout,
  getPosition,
  distance,
  boundedScan,
  safeMoveTo,
  maybeEatFromInventory,
  attackNearestHostileMob,
  say
}
