const RESOURCE_KEYS = ['food_stock', 'wood_stock', 'ore_stock']

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function ensureEconomyState(settlementState) {
  if (!settlementState.economy || typeof settlementState.economy !== 'object') {
    settlementState.economy = {}
  }

  const economy = settlementState.economy
  economy.taxRate = clamp(toNumber(economy.taxRate, 0.1), 0, 0.9)
  economy.councilBudget = toNumber(economy.councilBudget, 0)

  economy.inventoryGoals = economy.inventoryGoals || {}
  economy.virtualStorage = economy.virtualStorage || {}
  economy.basePrices = economy.basePrices || {}
  economy.prices = economy.prices || {}
  economy.tradeHistory = Array.isArray(economy.tradeHistory) ? economy.tradeHistory : []
  economy.contracts = Array.isArray(economy.contracts) ? economy.contracts : []

  for (const key of RESOURCE_KEYS) {
    economy.inventoryGoals[key] = Math.max(1, toNumber(economy.inventoryGoals[key], 1))
    economy.virtualStorage[key] = Math.max(0, toNumber(economy.virtualStorage[key], 0))
    economy.basePrices[key] = Math.max(1, toNumber(economy.basePrices[key], 1))
    economy.prices[key] = Math.max(1, toNumber(economy.prices[key], economy.basePrices[key]))
  }

  return economy
}

function recalculatePrices(settlementState) {
  const economy = ensureEconomyState(settlementState)
  for (const key of RESOURCE_KEYS) {
    const goal = Math.max(1, economy.inventoryGoals[key])
    const current = Math.max(0, economy.virtualStorage[key])
    const scarcity = clamp((goal - current) / goal, -0.5, 1.5)
    const multiplier = 1 + scarcity * 1.2
    economy.prices[key] = Math.max(1, Math.round(economy.basePrices[key] * multiplier))
  }

  return economy.prices
}

function depositVirtualGoods(settlementState, goods, source = 'task') {
  const economy = ensureEconomyState(settlementState)
  const delivered = {}

  for (const key of RESOURCE_KEYS) {
    const amount = toNumber(goods?.[key], 0)
    if (amount <= 0) {
      continue
    }

    economy.virtualStorage[key] += amount
    delivered[key] = (delivered[key] || 0) + amount
  }

  if (Object.keys(delivered).length > 0) {
    economy.tradeHistory.push({
      at: new Date().toISOString(),
      type: 'delivery',
      source,
      delivered
    })
    economy.tradeHistory = economy.tradeHistory.slice(-300)
    recalculatePrices(settlementState)
  }

  return delivered
}

function consumeFoodStock(settlementState, amount, reason = 'ration') {
  const economy = ensureEconomyState(settlementState)
  const requested = Math.max(0, toNumber(amount, 0))
  const available = economy.virtualStorage.food_stock
  const consumed = Math.min(requested, available)

  if (consumed > 0) {
    economy.virtualStorage.food_stock -= consumed
    economy.tradeHistory.push({
      at: new Date().toISOString(),
      type: 'consumption',
      reason,
      consumed: { food_stock: consumed }
    })
    economy.tradeHistory = economy.tradeHistory.slice(-300)
    recalculatePrices(settlementState)
  }

  return consumed
}

function recordTradeProfit(settlementState, trade) {
  const economy = ensureEconomyState(settlementState)
  const grossProfit = Math.max(0, toNumber(trade?.grossProfit, 0))
  const resource = String(trade?.resource || 'food_stock')
  const qty = Math.max(0, toNumber(trade?.qty, 0))
  const actor = String(trade?.actor || 'unknown')
  const taxRate = clamp(
    toNumber(economy.taxRate, 0.1) || toNumber(settlementState?.authority?.institutions?.council?.taxRate, 0.1),
    0,
    0.9
  )

  const tax = Number((grossProfit * taxRate).toFixed(2))
  const net = Number((grossProfit - tax).toFixed(2))

  economy.councilBudget = Number((economy.councilBudget + tax).toFixed(2))
  if (settlementState?.authority?.institutions?.council) {
    settlementState.authority.institutions.council.budget = economy.councilBudget
  }

  economy.tradeHistory.push({
    at: new Date().toISOString(),
    type: 'trade',
    actor,
    resource,
    qty,
    grossProfit,
    tax,
    net
  })
  economy.tradeHistory = economy.tradeHistory.slice(-300)

  return {
    grossProfit,
    tax,
    net
  }
}

function getPriorityContracts(settlementState) {
  const economy = ensureEconomyState(settlementState)
  const contracts = economy.contracts.map((contract) => ({ ...contract }))

  contracts.sort((a, b) => {
    const aGoal = Math.max(1, toNumber(economy.inventoryGoals[a.resource], a.target))
    const bGoal = Math.max(1, toNumber(economy.inventoryGoals[b.resource], b.target))
    const aCurrent = toNumber(economy.virtualStorage[a.resource], 0)
    const bCurrent = toNumber(economy.virtualStorage[b.resource], 0)

    const aDeficit = (a.target || aGoal) - aCurrent
    const bDeficit = (b.target || bGoal) - bCurrent

    const aScore = toNumber(a.priority, 0) + Math.max(0, aDeficit / aGoal)
    const bScore = toNumber(b.priority, 0) + Math.max(0, bDeficit / bGoal)
    return bScore - aScore
  })

  return contracts
}

function getEconomyStatus(settlementState) {
  const economy = ensureEconomyState(settlementState)
  recalculatePrices(settlementState)

  const storage = RESOURCE_KEYS.map((key) => {
    const current = Math.round(economy.virtualStorage[key])
    const goal = Math.round(economy.inventoryGoals[key])
    const price = economy.prices[key]
    return `${key} ${current}/${goal} (price ${price})`
  }).join(', ')

  return {
    councilBudget: economy.councilBudget,
    taxRate: economy.taxRate,
    storage,
    prices: { ...economy.prices },
    contracts: getPriorityContracts(settlementState).slice(0, 3)
  }
}

module.exports = {
  RESOURCE_KEYS,
  ensureEconomyState,
  recalculatePrices,
  depositVirtualGoods,
  consumeFoodStock,
  recordTradeProfit,
  getPriorityContracts,
  getEconomyStatus
}
