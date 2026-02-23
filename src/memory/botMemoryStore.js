const fs = require('fs')
const path = require('path')

const BOT_MEMORY_DIR = path.resolve(process.cwd(), 'data', 'bot-memory')
const MAX_REFLECTIONS = 200

const DEFAULT_NEEDS = {
  hunger: 72,
  fatigue: 74,
  safety: 70,
  social: 62,
  purpose: 66,
  faith: 58
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sanitizeBotName(botName) {
  return String(botName || 'unknown-bot').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function ensureMemoryDir() {
  if (!fs.existsSync(BOT_MEMORY_DIR)) {
    fs.mkdirSync(BOT_MEMORY_DIR, { recursive: true })
  }
}

function getMemoryPath(botName) {
  const safeName = sanitizeBotName(botName)
  return path.join(BOT_MEMORY_DIR, `${safeName}.json`)
}

function defaultMemory(botName) {
  return {
    botName: sanitizeBotName(botName),
    mode: 'auto',
    roleOverride: null,
    needs: clone(DEFAULT_NEEDS),
    mood: 'steady',
    cooldowns: {},
    reflections: [],
    stats: {
      tasksCompleted: {},
      tasksFailed: {}
    },
    updatedAt: null
  }
}

function sanitizeNeeds(needs) {
  const result = clone(DEFAULT_NEEDS)
  for (const key of Object.keys(DEFAULT_NEEDS)) {
    if (Number.isFinite(Number(needs?.[key]))) {
      result[key] = clamp(Number(needs[key]), 0, 100)
    }
  }
  return result
}

function sanitizeMemory(botName, raw) {
  const base = defaultMemory(botName)
  const memory = {
    ...base,
    ...(raw && typeof raw === 'object' ? raw : {})
  }

  memory.botName = sanitizeBotName(botName)
  memory.mode = memory.mode === 'manual' ? 'manual' : 'auto'
  memory.roleOverride = memory.roleOverride || null
  memory.needs = sanitizeNeeds(memory.needs)
  memory.mood = String(memory.mood || 'steady')
  memory.cooldowns = memory.cooldowns && typeof memory.cooldowns === 'object'
    ? memory.cooldowns
    : {}
  memory.reflections = Array.isArray(memory.reflections)
    ? memory.reflections.slice(-MAX_REFLECTIONS)
    : []
  memory.stats = memory.stats && typeof memory.stats === 'object'
    ? memory.stats
    : { tasksCompleted: {}, tasksFailed: {} }

  if (!memory.stats.tasksCompleted || typeof memory.stats.tasksCompleted !== 'object') {
    memory.stats.tasksCompleted = {}
  }

  if (!memory.stats.tasksFailed || typeof memory.stats.tasksFailed !== 'object') {
    memory.stats.tasksFailed = {}
  }

  return memory
}

function loadBotMemory(botName) {
  ensureMemoryDir()
  const filePath = getMemoryPath(botName)
  if (!fs.existsSync(filePath)) {
    return defaultMemory(botName)
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return sanitizeMemory(botName, JSON.parse(raw))
  } catch (error) {
    return defaultMemory(botName)
  }
}

function saveBotMemory(botName, memory) {
  ensureMemoryDir()
  const filePath = getMemoryPath(botName)
  const sanitized = sanitizeMemory(botName, memory)
  sanitized.updatedAt = new Date().toISOString()
  fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2), 'utf8')
  return sanitized
}

function appendReflection(botName, entry) {
  const memory = loadBotMemory(botName)
  memory.reflections.push({
    at: new Date().toISOString(),
    ...entry
  })
  memory.reflections = memory.reflections.slice(-MAX_REFLECTIONS)
  return saveBotMemory(botName, memory)
}

function setCooldown(botName, key, durationMs) {
  const memory = loadBotMemory(botName)
  memory.cooldowns[key] = Date.now() + Math.max(0, Number(durationMs) || 0)
  return saveBotMemory(botName, memory)
}

function cooldownRemainingMs(botName, key) {
  const memory = loadBotMemory(botName)
  const until = Number(memory.cooldowns[key]) || 0
  return Math.max(0, until - Date.now())
}

module.exports = {
  BOT_MEMORY_DIR,
  DEFAULT_NEEDS,
  loadBotMemory,
  saveBotMemory,
  appendReflection,
  setCooldown,
  cooldownRemainingMs
}
