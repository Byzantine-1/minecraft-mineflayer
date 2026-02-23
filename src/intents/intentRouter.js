const { evaluateIntentLegality, enforcementResponse } = require('../behavior/laws')
const { parseChatIntent, parseStdinIntent, validateIntent } = require('./intentSchema')

function normalizeAdminUsers(adminUsersInput) {
  if (Array.isArray(adminUsersInput)) {
    return adminUsersInput
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  }

  return String(adminUsersInput || process.env.ADMIN_USERS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function formatEconomyStatus(status) {
  const topContracts = (status?.contracts || [])
    .slice(0, 2)
    .map((contract) => `${contract.id}:${contract.resource}=>${contract.target}`)
    .join(', ')

  return [
    `[Economy] budget=${status.councilBudget} tax=${status.taxRate}`,
    `[Economy] storage ${status.storage}`,
    `[Economy] board ${topContracts || 'none'}`
  ]
}

function formatSettlementStatus(status) {
  const events = status?.events || {}
  const war = events.war || {}
  const population = status?.population || {}
  const reputation = status?.reputation || {}
  const repLine = Object.entries(reputation)
    .slice(0, 3)
    .map(([user, value]) => `${user}:${value}`)
    .join(', ')
  return [
    `[Settlement] famine=${events.famineSeverity} longNight=${events.longNight} raid=${events.raidSeverity}`,
    `[Settlement] war=${war.factionA || 'none'} vs ${war.factionB || 'none'} @ ${war.intensity || 0}`,
    `[Settlement] pop=${population.simulatedPopulation} households=${population.households} morale=${population.morale}`,
    `[Settlement] births=${population.births} deaths=${population.deaths} migration=${population.migrationNet}`,
    `[Settlement] reputation ${repLine || 'no violations recorded'}`
  ]
}

class IntentRouter {
  constructor({ runtime, worldAuthority, adminUsers }) {
    this.runtime = runtime
    this.worldAuthority = worldAuthority
    this.adminUsers = new Set(normalizeAdminUsers(adminUsers))
  }

  isAdmin(username) {
    if (!username) {
      return false
    }
    return this.adminUsers.has(String(username).toLowerCase())
  }

  async handleChat({ botName, username, message }) {
    const parsed = parseChatIntent(message)
    if (!parsed) {
      return false
    }

    const validated = validateIntent(parsed)
    if (!validated.ok) {
      this.respond(botName, `[Intent] ${validated.error}`)
      return true
    }

    return this.routeIntent({
      intent: validated.value,
      sourceType: 'chat',
      botName,
      username: username || 'unknown',
      isAdmin: this.isAdmin(username)
    })
  }

  async handleStdin(line) {
    const parsed = parseStdinIntent(line)
    if (!parsed) {
      return false
    }

    const validated = validateIntent(parsed)
    if (!validated.ok) {
      this.runtime.log(`[stdin] ${validated.error}`)
      return true
    }

    const targetBot = parsed.botName || this.runtime.getDefaultBotName()
    return this.routeIntent({
      intent: validated.value,
      sourceType: 'stdin',
      botName: targetBot,
      username: 'stdin',
      isAdmin: true
    })
  }

  routeIntent(context) {
    const { intent, botName, username, isAdmin } = context
    const legality = evaluateIntentLegality(intent, { isAdmin })
    if (!legality.allowed) {
      const message = enforcementResponse({
        lawName: legality.lawName,
        reason: legality.reason
      })
      const reputation = this.worldAuthority.recordViolation(username, legality.lawName)
      this.runtime.log(`[LawViolation] user=${username} intent=${intent.type} law=${legality.lawName} reason=${legality.reason}`)
      this.respond(botName, message)
      this.broadcast(
        `[Law] Violation report: ${username} attempted ${intent.type} blocked by ${legality.lawName}. reputation=${reputation}`
      )
      return true
    }

    switch (intent.type) {
      case 'mode.set':
        return this.handleSetMode(botName, intent.mode)
      case 'role.set':
        return this.handleSetRole(botName, intent.role)
      case 'law.list':
        return this.handleLawList(botName)
      case 'law.set':
        return this.handleSetLaw(botName, intent.lawName, intent.enabled, username)
      case 'council.decree':
        return this.handleCouncilDecree(intent.text, username)
      case 'event.famine':
        return this.handleFamine(intent.severity, username)
      case 'event.longnight':
        return this.handleLongNight(intent.enabled, username)
      case 'event.war':
        return this.handleWar(intent.factionA, intent.factionB, intent.intensity, username)
      case 'economy.status':
        return this.handleEconomyStatus(botName)
      case 'settlement.status':
        return this.handleSettlementStatus(botName)
      case 'stop':
        return this.handleStop(botName)
      default:
        this.respond(botName, `[Intent] Unsupported intent ${intent.type}`)
        return true
    }
  }

  handleSetMode(botName, mode) {
    const result = this.runtime.setBotMode(botName, mode)
    this.respond(botName, `[Mara] mode set to ${result?.mode || mode}`)
    return true
  }

  handleSetRole(botName, role) {
    const result = this.runtime.setBotRole(botName, role)
    if (!result?.ok) {
      this.respond(botName, `[Mara] ${result?.error || 'Unable to set role.'}`)
      return true
    }
    this.respond(botName, `[Mara] role override set to ${role}`)
    return true
  }

  handleLawList(botName) {
    const laws = this.worldAuthority.listLaws()
    this.respond(botName, '[Law] Current law state:')
    for (const law of laws) {
      this.respond(
        botName,
        `[Law] ${law.name}=${law.enabled ? 'on' : 'off'} - ${law.description}`
      )
    }
    return true
  }

  handleSetLaw(botName, lawName, enabled, username) {
    const result = this.worldAuthority.setLaw(lawName, enabled, username)
    if (!result?.ok) {
      this.respond(botName, `[Law] ${result?.error || 'Failed to update law.'}`)
      return true
    }

    this.broadcast(`[Law] ${result.law} set to ${result.enabled ? 'on' : 'off'} by ${username}`)
    return true
  }

  handleCouncilDecree(text, username) {
    const decree = this.worldAuthority.addCouncilDecree(text, username)
    if (!decree) {
      return true
    }

    const roleDirective = decree.match(/^role\s+set\s+(\S+)\s+(\S+)$/i)
    if (roleDirective) {
      const target = roleDirective[1]
      const role = String(roleDirective[2]).toLowerCase()

      if (target.toLowerCase() === 'all') {
        const results = Array.from(this.runtime.bots.keys()).map((botName) =>
          this.runtime.setBotRole(botName, role, 'decree')
        )
        const failed = results.some((result) => !result.ok)
        this.broadcast(
          failed
            ? `[Council] decree applied with errors while setting role '${role}' for all bots.`
            : `[Council] decree set role '${role}' for all bots.`
        )
      } else {
        const result = this.runtime.setBotRole(target, role, 'decree')
        this.broadcast(
          result.ok
            ? `[Council] decree set role '${role}' for ${target}.`
            : `[Council] decree role update failed for ${target}: ${result.error}`
        )
      }
    }

    this.broadcast(`[Council] decree: ${decree}`)
    return true
  }

  handleFamine(severity, username) {
    const value = this.worldAuthority.setFamine(severity, username)
    this.broadcast(`[Event] famine severity now ${value}`)
    return true
  }

  handleLongNight(enabled, username) {
    const value = this.worldAuthority.setLongNight(enabled, username)
    this.broadcast(`[Event] long night ${value ? 'enabled' : 'disabled'}`)
    return true
  }

  handleWar(factionA, factionB, intensity, username) {
    const war = this.worldAuthority.setWar(factionA, factionB, intensity, username)
    this.broadcast(`[Event] war ${war.factionA} vs ${war.factionB} @ ${war.intensity}`)
    return true
  }

  handleEconomyStatus(botName) {
    const status = this.worldAuthority.getEconomyStatus()
    const lines = formatEconomyStatus(status)
    for (const line of lines) {
      this.broadcast(line)
    }
    return true
  }

  handleSettlementStatus(botName) {
    const status = this.worldAuthority.getSettlementStatus()
    const lines = formatSettlementStatus(status)
    for (const line of lines) {
      this.broadcast(line)
    }
    return true
  }

  handleStop(botName) {
    const stopped = this.runtime.stopActiveTask(botName)
    if (stopped) {
      this.respond(botName, '[Mara] STOP received, cancelling current action.')
    } else {
      this.respond(botName, '[Mara] No active task to cancel.')
    }
    return true
  }

  respond(botName, message) {
    this.runtime.sendChat(botName, message)
  }

  broadcast(message) {
    this.runtime.broadcast(message)
  }
}

module.exports = {
  IntentRouter
}
