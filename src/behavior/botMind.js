const {
  DEFAULT_NEEDS,
  loadBotMemory,
  saveBotMemory
} = require('../memory/botMemoryStore')

const ROLE_NAMES = [
  'trader',
  'woodcutter',
  'miner',
  'farmer',
  'guard',
  'cleric',
  'builder'
]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function hashName(input) {
  const text = String(input || '')
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function deterministicRoleSet(botName) {
  const hash = hashName(botName)
  const primary = ROLE_NAMES[hash % ROLE_NAMES.length]
  let secondary = ROLE_NAMES[(Math.floor(hash / ROLE_NAMES.length) + 2) % ROLE_NAMES.length]
  if (secondary === primary) {
    secondary = ROLE_NAMES[(ROLE_NAMES.indexOf(primary) + 1) % ROLE_NAMES.length]
  }
  return { primary, secondary }
}

function moodFromNeeds(needs) {
  const values = Object.values(needs)
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  const min = Math.min(...values)

  if (min < 20) {
    return 'distressed'
  }

  if (avg < 45) {
    return 'strained'
  }

  if (avg > 75) {
    return 'content'
  }

  return 'steady'
}

class BotMind {
  constructor(botName) {
    this.botName = String(botName || 'unknown-bot')
    this.defaultRoleSet = deterministicRoleSet(this.botName)

    const memory = loadBotMemory(this.botName)
    this.mode = memory.mode === 'manual' ? 'manual' : 'auto'
    this.needs = { ...DEFAULT_NEEDS, ...memory.needs }
    this.mood = memory.mood || moodFromNeeds(this.needs)
    this.roleOverride = memory.roleOverride || null
    this.cooldowns = memory.cooldowns || {}
    this.stats = memory.stats || { tasksCompleted: {}, tasksFailed: {} }
    this.lastTask = null
    this.lastUpdateMs = Date.now()
  }

  getRoles() {
    if (this.roleOverride && ROLE_NAMES.includes(this.roleOverride)) {
      return {
        primary: this.roleOverride,
        secondary: this.defaultRoleSet.secondary
      }
    }
    return { ...this.defaultRoleSet }
  }

  getPrimaryRole() {
    return this.getRoles().primary
  }

  setMode(mode) {
    this.mode = mode === 'manual' ? 'manual' : 'auto'
    this.persist()
    return this.mode
  }

  setRoleOverride(roleName, source = 'command') {
    const normalized = String(roleName || '').trim().toLowerCase()
    if (!ROLE_NAMES.includes(normalized)) {
      return {
        ok: false,
        error: `Unknown role '${roleName}'.`
      }
    }

    if (source !== 'command' && source !== 'decree') {
      return {
        ok: false,
        error: `Role changes must come from governance decree or explicit command.`
      }
    }

    this.roleOverride = normalized
    this.persist()
    return {
      ok: true,
      role: normalized
    }
  }

  clearRoleOverride(source = 'command') {
    if (source !== 'command' && source !== 'decree') {
      return {
        ok: false,
        error: 'Role override clear requires command/decree source.'
      }
    }
    this.roleOverride = null
    this.persist()
    return { ok: true, role: this.getPrimaryRole() }
  }

  updateNeeds({ perception, authoritySnapshot, elapsedMs }) {
    const elapsedSeconds = Math.max(1, Math.round((elapsedMs || 2500) / 1000))
    const danger = Number(authoritySnapshot?.nightDangerIndex) || 0

    this.needs.hunger = clamp(this.needs.hunger - 0.55 * elapsedSeconds, 0, 100)
    this.needs.fatigue = clamp(this.needs.fatigue - 0.4 * elapsedSeconds, 0, 100)
    this.needs.social = clamp(this.needs.social - 0.22 * elapsedSeconds, 0, 100)
    this.needs.purpose = clamp(this.needs.purpose - 0.24 * elapsedSeconds, 0, 100)
    this.needs.faith = clamp(this.needs.faith - 0.12 * elapsedSeconds, 0, 100)

    const threatPenalty = (danger / 100) * 0.45 * elapsedSeconds
    this.needs.safety = clamp(this.needs.safety - threatPenalty, 0, 100)

    if (perception?.hostileMobCount > 0) {
      this.needs.safety = clamp(
        this.needs.safety - perception.hostileMobCount * 1.6,
        0,
        100
      )
    }

    if (perception?.nearbyFriendlyCount > 0) {
      this.needs.social = clamp(
        this.needs.social + Math.min(8, perception.nearbyFriendlyCount * 0.9),
        0,
        100
      )
      this.needs.safety = clamp(this.needs.safety + 0.8, 0, 100)
    }

    if (authoritySnapshot?.serviceActive) {
      this.needs.faith = clamp(this.needs.faith + 6, 0, 100)
      this.needs.social = clamp(this.needs.social + 3, 0, 100)
    }

    if (authoritySnapshot?.events?.famineSeverity >= 60) {
      this.needs.hunger = clamp(this.needs.hunger - 0.4 * elapsedSeconds, 0, 100)
      this.needs.purpose = clamp(this.needs.purpose + 0.5 * elapsedSeconds, 0, 100)
    }

    this.mood = moodFromNeeds(this.needs)
    this.lastUpdateMs = Date.now()
    this.persist()

    return { ...this.needs }
  }

  applyTaskOutcome(outcome) {
    const needDelta = outcome?.needDelta
    if (needDelta && typeof needDelta === 'object') {
      for (const [key, delta] of Object.entries(needDelta)) {
        if (typeof this.needs[key] !== 'number') {
          continue
        }
        this.needs[key] = clamp(this.needs[key] + Number(delta), 0, 100)
      }
    }

    this.mood = moodFromNeeds(this.needs)
    this.persist()
  }

  setTaskCooldown(taskId, durationMs) {
    this.cooldowns[taskId] = Date.now() + Math.max(0, Number(durationMs) || 0)
    this.persist()
  }

  getCooldownRemainingMs(taskId) {
    const until = Number(this.cooldowns[taskId]) || 0
    return Math.max(0, until - Date.now())
  }

  canRunTask(taskId) {
    return this.getCooldownRemainingMs(taskId) === 0
  }

  recordTaskResult(taskId, ok) {
    const bucket = ok ? this.stats.tasksCompleted : this.stats.tasksFailed
    bucket[taskId] = (bucket[taskId] || 0) + 1
    this.lastTask = {
      id: taskId,
      ok: !!ok,
      at: new Date().toISOString()
    }
    this.persist()
  }

  toSnapshot() {
    return {
      botName: this.botName,
      mode: this.mode,
      roles: this.getRoles(),
      needs: { ...this.needs },
      mood: this.mood,
      lastTask: this.lastTask
    }
  }

  persist() {
    saveBotMemory(this.botName, {
      botName: this.botName,
      mode: this.mode,
      roleOverride: this.roleOverride,
      needs: this.needs,
      mood: this.mood,
      cooldowns: this.cooldowns,
      stats: this.stats
    })
  }
}

module.exports = {
  ROLE_NAMES,
  BotMind,
  deterministicRoleSet
}
