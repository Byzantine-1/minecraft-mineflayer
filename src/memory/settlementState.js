const fs = require('fs')
const path = require('path')

const DATA_DIR = path.resolve(process.cwd(), 'data')
const SETTLEMENT_FILE = path.join(DATA_DIR, 'settlement-state.json')

const DEFAULT_STATE = {
  version: 1,
  updatedAt: null,
  seedBase: Number(process.env.SETTLEMENT_SEED) || 99173,
  dayStamp: 0,
  daySeed: 0,
  authority: {
    nightDangerIndex: 10,
    laws: {},
    reputation: {},
    events: {
      longNight: false,
      famineSeverity: 0,
      war: {
        factionA: null,
        factionB: null,
        intensity: 0
      },
      raidSeverity: 0
    },
    institutions: {
      church: {
        serviceEveryDays: 3,
        moraleBuff: 6,
        nextServiceDay: 0,
        charityMode: false
      },
      council: {
        taxRate: 0.1,
        budget: 0,
        decrees: [],
        priorities: {
          food: 1,
          expansion: 0.4,
          defense: 0.6
        }
      },
      militia: {
        musterActive: false,
        rallyPoint: null,
        patrolRadius: 28
      }
    }
  },
  economy: {
    taxRate: 0.1,
    councilBudget: 0,
    inventoryGoals: {
      food_stock: 120,
      wood_stock: 80,
      ore_stock: 60
    },
    virtualStorage: {
      food_stock: 24,
      wood_stock: 18,
      ore_stock: 8
    },
    basePrices: {
      food_stock: 5,
      wood_stock: 4,
      ore_stock: 8
    },
    prices: {
      food_stock: 5,
      wood_stock: 4,
      ore_stock: 8
    },
    contracts: [
      {
        id: 'board_food_stock',
        resource: 'food_stock',
        target: 120,
        priority: 1
      },
      {
        id: 'board_wood_stock',
        resource: 'wood_stock',
        target: 80,
        priority: 0.8
      },
      {
        id: 'board_ore_stock',
        resource: 'ore_stock',
        target: 60,
        priority: 0.7
      }
    ],
    tradeHistory: []
  },
  population: {
    simulatedPopulation: 12,
    households: 4,
    births: 0,
    deaths: 0,
    migrationNet: 0,
    morale: 60,
    workforce: {
      trader: 2,
      woodcutter: 2,
      miner: 2,
      farmer: 3,
      guard: 2,
      cleric: 1,
      builder: 0
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function mergeDeep(base, override) {
  if (!isObject(base)) {
    return clone(override)
  }

  const merged = clone(base)
  if (!isObject(override)) {
    return merged
  }

  for (const key of Object.keys(override)) {
    const incoming = override[key]
    if (Array.isArray(incoming)) {
      merged[key] = clone(incoming)
      continue
    }

    if (isObject(incoming) && isObject(merged[key])) {
      merged[key] = mergeDeep(merged[key], incoming)
      continue
    }

    merged[key] = incoming
  }

  return merged
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function sanitizeSettlementState(rawState) {
  const state = mergeDeep(DEFAULT_STATE, rawState)

  state.seedBase = Number.isFinite(Number(state.seedBase))
    ? Number(state.seedBase)
    : DEFAULT_STATE.seedBase

  state.dayStamp = Number.isFinite(Number(state.dayStamp))
    ? Number(state.dayStamp)
    : 0

  state.daySeed = Number.isFinite(Number(state.daySeed))
    ? Number(state.daySeed)
    : 0

  state.authority.events.famineSeverity = clamp(
    Number(state.authority.events.famineSeverity) || 0,
    0,
    100
  )

  state.authority.events.war.intensity = clamp(
    Number(state.authority.events.war.intensity) || 0,
    0,
    100
  )

  state.authority.events.raidSeverity = clamp(
    Number(state.authority.events.raidSeverity) || 0,
    0,
    100
  )

  state.authority.nightDangerIndex = clamp(
    Number(state.authority.nightDangerIndex) || 0,
    0,
    100
  )

  if (!state.authority.reputation || typeof state.authority.reputation !== 'object') {
    state.authority.reputation = {}
  }

  state.population.morale = clamp(Number(state.population.morale) || 0, 0, 100)
  state.population.simulatedPopulation = Math.max(
    1,
    Number(state.population.simulatedPopulation) || 1
  )
  state.population.households = Math.max(
    1,
    Number(state.population.households) || 1
  )

  const numericBuckets = [
    state.economy.taxRate,
    state.authority.institutions.council.taxRate
  ]
  for (const value of numericBuckets) {
    if (!Number.isFinite(Number(value))) {
      state.economy.taxRate = DEFAULT_STATE.economy.taxRate
      state.authority.institutions.council.taxRate =
        DEFAULT_STATE.authority.institutions.council.taxRate
    }
  }

  return state
}

function deriveDaySeed(seedBase, dayStamp) {
  let value = (Number(seedBase) ^ ((Number(dayStamp) + 1) * 2246822519)) >>> 0
  value = (value ^ (value >>> 16)) >>> 0
  value = Math.imul(value, 3266489917) >>> 0
  value = (value ^ (value >>> 13)) >>> 0
  return value >>> 0
}

function ensureSettlementFile() {
  ensureDataDir()
  if (!fs.existsSync(SETTLEMENT_FILE)) {
    const initial = sanitizeSettlementState(DEFAULT_STATE)
    initial.updatedAt = new Date().toISOString()
    fs.writeFileSync(SETTLEMENT_FILE, JSON.stringify(initial, null, 2), 'utf8')
  }
}

function loadSettlementState() {
  ensureSettlementFile()
  try {
    const raw = fs.readFileSync(SETTLEMENT_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return sanitizeSettlementState(parsed)
  } catch (error) {
    const fallback = sanitizeSettlementState(DEFAULT_STATE)
    fallback.updatedAt = new Date().toISOString()
    fs.writeFileSync(SETTLEMENT_FILE, JSON.stringify(fallback, null, 2), 'utf8')
    return fallback
  }
}

function saveSettlementState(nextState) {
  ensureSettlementFile()
  const sanitized = sanitizeSettlementState(nextState)
  sanitized.updatedAt = new Date().toISOString()
  fs.writeFileSync(SETTLEMENT_FILE, JSON.stringify(sanitized, null, 2), 'utf8')
  return sanitized
}

function updateSettlementState(mutator) {
  const current = loadSettlementState()
  const draft = clone(current)
  const candidate = typeof mutator === 'function' ? mutator(draft) : draft
  return saveSettlementState(candidate || draft)
}

function refreshDaySeed(state, dayStamp) {
  if (!state || typeof state !== 'object') {
    return state
  }

  if (Number(state.dayStamp) !== Number(dayStamp)) {
    state.dayStamp = Number(dayStamp)
    state.daySeed = deriveDaySeed(state.seedBase, dayStamp)
  } else if (!state.daySeed) {
    state.daySeed = deriveDaySeed(state.seedBase, dayStamp)
  }

  return state
}

module.exports = {
  DATA_DIR,
  SETTLEMENT_FILE,
  DEFAULT_STATE,
  clamp,
  clone,
  deriveDaySeed,
  loadSettlementState,
  saveSettlementState,
  updateSettlementState,
  refreshDaySeed
}
