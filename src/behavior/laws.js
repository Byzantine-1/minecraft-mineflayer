const LAW_DEFINITIONS = {
  curfew: {
    description: 'After dusk, civilians return to shelter while militia patrols.',
    defaultEnabled: true
  },
  no_attack_players: {
    description: 'Bots may never attack players.',
    defaultEnabled: true
  },
  no_breaking_blocks: {
    description: 'Bots cannot break blocks unless explicitly authorized.',
    defaultEnabled: true
  },
  trade_fairness: {
    description: 'Trades must be authorized and tax-tracked.',
    defaultEnabled: true
  },
  rationing: {
    description: 'During famine, food is rationed and low-priority work is reduced.',
    defaultEnabled: true
  },
  no_chest_take: {
    description: 'Bots do not take from chests unless explicitly allowed.',
    defaultEnabled: true
  }
}

const CIVILIAN_ROLES = new Set(['trader', 'woodcutter', 'miner', 'farmer', 'builder'])
const MILITIA_ROLES = new Set(['guard', 'militia'])

function getLawState(settlementState) {
  const current = settlementState?.authority?.laws || {}
  const laws = {}
  for (const [name, definition] of Object.entries(LAW_DEFINITIONS)) {
    if (typeof current[name] === 'boolean') {
      laws[name] = current[name]
      continue
    }
    laws[name] = definition.defaultEnabled
  }
  return laws
}

function listLaws(settlementState) {
  const current = getLawState(settlementState)
  return Object.entries(LAW_DEFINITIONS).map(([name, definition]) => ({
    name,
    enabled: current[name],
    description: definition.description
  }))
}

function setLawEnabled(settlementState, lawName, enabled) {
  const normalizedLaw = String(lawName || '').trim().toLowerCase()
  if (!LAW_DEFINITIONS[normalizedLaw]) {
    return {
      ok: false,
      error: `Unknown law '${lawName}'.`
    }
  }

  if (!settlementState.authority || typeof settlementState.authority !== 'object') {
    settlementState.authority = {}
  }

  if (!settlementState.authority.laws || typeof settlementState.authority.laws !== 'object') {
    settlementState.authority.laws = {}
  }

  settlementState.authority.laws[normalizedLaw] = !!enabled
  return {
    ok: true,
    law: normalizedLaw,
    enabled: !!enabled
  }
}

function enforcementResponse({ lawName, reason }) {
  return `Refusing request due to law '${lawName}': ${reason}.`
}

function evaluateIntentLegality(intent, context) {
  if (!intent || typeof intent !== 'object') {
    return {
      allowed: false,
      lawName: 'unknown',
      reason: 'Intent payload was not valid.'
    }
  }

  if (intent.type === 'law.set' || intent.type.startsWith('event.') || intent.type === 'council.decree') {
    if (!context?.isAdmin) {
      return {
        allowed: false,
        lawName: 'governance',
        reason: 'Only admins can change laws or world events.'
      }
    }
  }

  return {
    allowed: true
  }
}

function evaluateTaskLegality(taskId, context) {
  const lawState = context?.lawState || {}
  const role = String(context?.role || 'civilian').toLowerCase()
  const isNight = !!context?.isNight
  const famineSeverity = Number(context?.famineSeverity) || 0
  const allowBlockBreaking = !!context?.allowBlockBreaking
  const allowCombat = !!context?.allowCombat
  const explicitChestTake = !!context?.allowChestTake
  const allowTrading = context?.allowTrading !== false

  if (lawState.no_attack_players && taskId === 'attackPlayer') {
    return {
      allowed: false,
      lawName: 'no_attack_players',
      reason: 'attacking players is disallowed'
    }
  }

  if (lawState.no_breaking_blocks && (taskId === 'chopWood' || taskId === 'mineOre') && !allowBlockBreaking) {
    return {
      allowed: false,
      lawName: 'no_breaking_blocks',
      reason: 'block breaking not explicitly allowed'
    }
  }

  if (lawState.no_chest_take && taskId === 'lootChest' && !explicitChestTake) {
    return {
      allowed: false,
      lawName: 'no_chest_take',
      reason: 'chest retrieval was not authorized'
    }
  }

  if (lawState.curfew && isNight && CIVILIAN_ROLES.has(role)) {
    const curfewAllowed = new Set(['healRest', 'fleeShelter', 'attendService'])
    if (!curfewAllowed.has(taskId)) {
      return {
        allowed: false,
        lawName: 'curfew',
        reason: 'civilian curfew requires returning to shelter'
      }
    }
  }

  if (taskId === 'raidDefense' && !allowCombat) {
    return {
      allowed: false,
      lawName: 'no_attack_players',
      reason: 'combat is disabled by policy toggle'
    }
  }

  if (!allowTrading && (taskId === 'workTrade' || taskId === 'escortCaravan' || taskId === 'diplomacy')) {
    return {
      allowed: false,
      lawName: 'trade_fairness',
      reason: 'trading is disabled by policy toggle'
    }
  }

  if (lawState.rationing && famineSeverity >= 60) {
    const rationedTasks = new Set(['diplomacy', 'workTrade'])
    if (rationedTasks.has(taskId)) {
      return {
        allowed: false,
        lawName: 'rationing',
        reason: 'rationing is active under severe famine'
      }
    }
  }

  return {
    allowed: true
  }
}

module.exports = {
  LAW_DEFINITIONS,
  getLawState,
  listLaws,
  setLawEnabled,
  enforcementResponse,
  evaluateIntentLegality,
  evaluateTaskLegality
}
