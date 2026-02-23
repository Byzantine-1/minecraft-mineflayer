const {
  clamp,
  loadSettlementState,
  refreshDaySeed,
  updateSettlementState
} = require('../memory/settlementState')
const { getMinecraftDay, getTimeOfDay, isNight, isServiceWindow } = require('./calendar')
const {
  consumeFoodStock,
  depositVirtualGoods,
  getEconomyStatus,
  recalculatePrices,
  recordTradeProfit
} = require('./economy')
const { getLawState, listLaws, setLawEnabled } = require('./laws')

function seededRng(seed) {
  let value = (Number(seed) || 1) >>> 0
  return () => {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return ((value >>> 0) % 1000000) / 1000000
  }
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function updateInstitutionSchedules(settlement, dayStamp) {
  const church = settlement.authority.institutions.church
  const cadence = Math.max(1, toNumber(church.serviceEveryDays, 3))
  church.nextServiceDay = dayStamp + ((cadence - (dayStamp % cadence)) % cadence)
  church.charityMode = settlement.authority.events.famineSeverity >= 55

  settlement.authority.institutions.council.taxRate = settlement.economy.taxRate
  settlement.authority.institutions.council.budget = settlement.economy.councilBudget

  const warIntensity = settlement.authority.events.war.intensity
  settlement.authority.institutions.militia.musterActive = warIntensity >= 50
}

function updatePopulationDaily(settlement, rng) {
  const famine = settlement.authority.events.famineSeverity
  const warIntensity = settlement.authority.events.war.intensity
  const population = settlement.population

  const stress = clamp(Math.round(famine * 0.4 + warIntensity * 0.5), 0, 100)
  const moraleDelta = clamp(Math.round((50 - stress) * 0.08), -8, 6)
  population.morale = clamp(population.morale + moraleDelta, 0, 100)

  const birthChance = clamp(0.08 + (population.morale - 40) / 300, 0.01, 0.2)
  const deathChance = clamp(0.03 + stress / 400, 0.01, 0.3)
  const migrationChance = clamp((population.morale - 50) / 200, -0.2, 0.2)

  let births = 0
  let deaths = 0
  let migrationNet = 0

  if (rng() < birthChance) {
    births = 1
  }
  if (rng() < deathChance) {
    deaths = 1
  }
  if (rng() < Math.abs(migrationChance)) {
    migrationNet = migrationChance >= 0 ? 1 : -1
  }

  population.births += births
  population.deaths += deaths
  population.migrationNet += migrationNet
  population.simulatedPopulation = Math.max(
    1,
    population.simulatedPopulation + births - deaths + migrationNet
  )
  population.households = Math.max(1, Math.round(population.simulatedPopulation / 3))

  rebalanceWorkforce(population)
}

function rebalanceWorkforce(population) {
  const total = Math.max(1, Math.round(population.simulatedPopulation * 0.65))
  const morale = population.morale

  let guardShare = 0.16
  if (morale < 45) {
    guardShare += 0.06
  }

  const guard = Math.max(1, Math.round(total * guardShare))
  const trader = Math.max(1, Math.round(total * 0.16))
  const woodcutter = Math.max(1, Math.round(total * 0.16))
  const miner = Math.max(1, Math.round(total * 0.16))
  const cleric = Math.max(1, Math.round(total * 0.08))
  const used = guard + trader + woodcutter + miner + cleric
  const farmer = Math.max(1, total - used)

  population.workforce = {
    trader,
    woodcutter,
    miner,
    farmer,
    guard,
    cleric,
    builder: 0
  }
}

function computeNightDanger(settlement, nightNow) {
  const events = settlement.authority.events
  let danger = nightNow ? 20 : 8
  danger += events.longNight ? 18 : 0
  danger += Math.round(events.famineSeverity * 0.2)
  danger += Math.round(events.war.intensity * 0.35)
  danger += Math.round(events.raidSeverity * 0.5)
  return clamp(danger, 0, 100)
}

function applyDailySimulation(settlement) {
  const rng = seededRng(settlement.daySeed || 1)
  const events = settlement.authority.events
  const warPressure = events.war.intensity * 0.003
  const longNightPressure = events.longNight ? 0.1 : 0.03
  const faminePressure = events.famineSeverity * 0.002
  const raidChance = clamp(warPressure + longNightPressure + faminePressure, 0, 0.55)

  events.raidSeverity = rng() < raidChance ? Math.round(clamp(20 + rng() * 80, 0, 100)) : 0
  updatePopulationDaily(settlement, rng)
}

class WorldAuthority {
  constructor() {
    this.state = loadSettlementState()
    this.lastDay = this.state.dayStamp
  }

  refresh(bot) {
    const dayStamp = getMinecraftDay(bot)
    const next = updateSettlementState((draft) => {
      refreshDaySeed(draft, dayStamp)

      if (draft.dayStamp !== this.lastDay) {
        applyDailySimulation(draft)
        this.lastDay = draft.dayStamp
      }

      updateInstitutionSchedules(draft, draft.dayStamp)
      recalculatePrices(draft)
      const nightNow = isNight(bot, draft.authority)
      draft.authority.nightDangerIndex = computeNightDanger(draft, nightNow)
      return draft
    })

    this.state = next
    return this.getSnapshot(bot)
  }

  getSnapshot(bot) {
    const authority = this.state.authority
    const dayStamp = getMinecraftDay(bot)
    const timeOfDay = getTimeOfDay(bot, authority)
    const nightNow = isNight(bot, authority)

    return {
      dayStamp,
      daySeed: this.state.daySeed,
      timeOfDay,
      isNight: nightNow,
      nightDangerIndex: authority.nightDangerIndex,
      events: {
        ...authority.events
      },
      institutions: {
        ...authority.institutions
      },
      lawState: getLawState(this.state),
      serviceActive: isServiceWindow(
        dayStamp,
        timeOfDay,
        authority.institutions.church
      )
    }
  }

  setFamine(severity, actor = 'system') {
    const normalized = clamp(Math.round(Number(severity) || 0), 0, 100)
    this.state = updateSettlementState((draft) => {
      draft.authority.events.famineSeverity = normalized
      draft.authority.institutions.council.decrees.push({
        at: new Date().toISOString(),
        actor,
        text: `Set famine severity to ${normalized}`
      })
      draft.authority.institutions.council.decrees =
        draft.authority.institutions.council.decrees.slice(-100)
      return draft
    })
    return this.state.authority.events.famineSeverity
  }

  setLongNight(enabled, actor = 'system') {
    this.state = updateSettlementState((draft) => {
      draft.authority.events.longNight = !!enabled
      draft.authority.institutions.council.decrees.push({
        at: new Date().toISOString(),
        actor,
        text: `Long night ${enabled ? 'enabled' : 'disabled'}`
      })
      draft.authority.institutions.council.decrees =
        draft.authority.institutions.council.decrees.slice(-100)
      return draft
    })
    return this.state.authority.events.longNight
  }

  setWar(factionA, factionB, intensity, actor = 'system') {
    const normalizedIntensity = clamp(Math.round(Number(intensity) || 0), 0, 100)
    this.state = updateSettlementState((draft) => {
      draft.authority.events.war = {
        factionA: factionA || null,
        factionB: factionB || null,
        intensity: normalizedIntensity
      }
      draft.authority.institutions.council.decrees.push({
        at: new Date().toISOString(),
        actor,
        text: `War state updated (${factionA || 'none'} vs ${factionB || 'none'} @ ${normalizedIntensity})`
      })
      draft.authority.institutions.council.decrees =
        draft.authority.institutions.council.decrees.slice(-100)
      return draft
    })
    return { ...this.state.authority.events.war }
  }

  addCouncilDecree(text, actor = 'system') {
    const decree = String(text || '').trim()
    if (!decree) {
      return null
    }

    this.state = updateSettlementState((draft) => {
      draft.authority.institutions.council.decrees.push({
        at: new Date().toISOString(),
        actor,
        text: decree
      })
      draft.authority.institutions.council.decrees =
        draft.authority.institutions.council.decrees.slice(-100)
      return draft
    })
    return decree
  }

  setLaw(name, enabled, actor = 'system') {
    let result = null
    this.state = updateSettlementState((draft) => {
      result = setLawEnabled(draft, name, enabled)
      if (result.ok) {
        draft.authority.institutions.council.decrees.push({
          at: new Date().toISOString(),
          actor,
          text: `Law '${result.law}' set to ${result.enabled ? 'on' : 'off'}`
        })
        draft.authority.institutions.council.decrees =
          draft.authority.institutions.council.decrees.slice(-100)
      }
      return draft
    })
    return result
  }

  listLaws() {
    this.state = loadSettlementState()
    return listLaws(this.state)
  }

  depositGoods(goods, actor = 'system', reason = 'task') {
    let delivered = {}
    this.state = updateSettlementState((draft) => {
      delivered = depositVirtualGoods(draft, goods, `${actor}:${reason}`)
      return draft
    })
    return delivered
  }

  consumeFood(amount, reason = 'ration') {
    let consumed = 0
    this.state = updateSettlementState((draft) => {
      consumed = consumeFoodStock(draft, amount, reason)
      return draft
    })
    return consumed
  }

  recordTrade(trade) {
    let summary = null
    this.state = updateSettlementState((draft) => {
      summary = recordTradeProfit(draft, trade)
      return draft
    })
    return summary
  }

  recordViolation(actor, lawName) {
    const username = String(actor || 'unknown').toLowerCase()
    const rule = String(lawName || 'unspecified')
    let nextValue = 0

    this.state = updateSettlementState((draft) => {
      const rep = draft.authority.reputation || {}
      const current = Number(rep[username]) || 0
      nextValue = current - 1
      rep[username] = nextValue
      draft.authority.reputation = rep
      draft.authority.institutions.council.decrees.push({
        at: new Date().toISOString(),
        actor: 'law-enforcement',
        text: `Reputation -1 for ${username} due to ${rule}`
      })
      draft.authority.institutions.council.decrees =
        draft.authority.institutions.council.decrees.slice(-100)
      return draft
    })

    return nextValue
  }

  getEconomyStatus() {
    this.state = loadSettlementState()
    return getEconomyStatus(this.state)
  }

  getSettlementStatus() {
    this.state = loadSettlementState()
    const economyStatus = getEconomyStatus(this.state)
    const population = this.state.population
    const events = this.state.authority.events
    const council = this.state.authority.institutions.council

    return {
      events,
      decrees: council.decrees.slice(-5),
      reputation: this.state.authority.reputation,
      economy: economyStatus,
      population: {
        simulatedPopulation: population.simulatedPopulation,
        households: population.households,
        morale: population.morale,
        births: population.births,
        deaths: population.deaths,
        migrationNet: population.migrationNet,
        workforce: population.workforce
      }
    }
  }
}

module.exports = {
  WorldAuthority
}
