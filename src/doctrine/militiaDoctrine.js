const {
  attackNearestHostileMob,
  clamp,
  sleep
} = require('../behavior/tasks/taskUtils')

const MILITIA_ROLES = new Set(['guard', 'militia'])

function isMilitiaRole(role) {
  return MILITIA_ROLES.has(String(role || '').toLowerCase())
}

function normalizeBotName(name) {
  return String(name || '').trim()
}

class MilitiaDoctrine {
  constructor({ runtime }) {
    this.runtime = runtime
  }

  getMilitiaUnits() {
    const units = []
    for (const botName of this.runtime.bots.keys()) {
      const role = this.runtime.getBotRole(botName)
      if (!isMilitiaRole(role)) {
        continue
      }
      units.push({ botName, role })
    }
    return units
  }

  musterToPortal({ portal } = {}) {
    const militia = this.getMilitiaUnits()
    for (const unit of militia) {
      const text = portal
        ? `[Doctrine] Muster at portal (${portal.x}, ${portal.y}, ${portal.z}).`
        : '[Doctrine] Muster at portal.'
      this.runtime.sendChat(unit.botName, text)
      this.runtime.stopActiveTask(unit.botName)
    }
    return {
      ok: true,
      militiaCount: militia.length
    }
  }

  holdPerimeter({ durationSec = 45, portal } = {}) {
    const boundedDuration = clamp(Number(durationSec) || 45, 5, 180)
    const militia = this.getMilitiaUnits()
    for (const unit of militia) {
      const text = portal
        ? `[Doctrine] Hold perimeter for ${boundedDuration}s around portal radius.`
        : `[Doctrine] Hold perimeter for ${boundedDuration}s.`
      this.runtime.sendChat(unit.botName, text)
    }
    return {
      ok: true,
      militiaCount: militia.length,
      durationSec: boundedDuration
    }
  }

  retreatToRally() {
    const militia = this.getMilitiaUnits()
    for (const unit of militia) {
      this.runtime.stopActiveTask(unit.botName)
      this.runtime.sendChat(unit.botName, '[Doctrine] Retreat to rally point.')
    }
    return {
      ok: true,
      militiaCount: militia.length
    }
  }

  async engageHostiles({
    bot,
    role,
    perception,
    allowCombat,
    durationSec = 10,
    radius = 12,
    retreatHp = 8,
    signal
  }) {
    const safeRole = String(role || '').toLowerCase()
    if (!isMilitiaRole(safeRole)) {
      return {
        ok: false,
        note: 'Only militia may engage hostiles.'
      }
    }

    if (!allowCombat) {
      return {
        ok: false,
        note: 'Combat disabled by policy toggle.'
      }
    }

    const health = Number(bot?.health)
    const hpThreshold = clamp(Number(retreatHp) || 8, 1, 20)
    if (Number.isFinite(health) && health <= hpThreshold) {
      return {
        ok: false,
        note: 'Retreating due to low HP threshold.'
      }
    }

    const engagementSec = clamp(Number(durationSec) || 10, 2, 45)
    const perimeterRadius = clamp(Number(radius) || 12, 4, 24)
    const candidates = Array.isArray(perception?.nearbyHostiles)
      ? perception.nearbyHostiles
        .filter((target) => Number(target?.distance) <= perimeterRadius)
        .slice(0, 4)
      : []

    if (candidates.length === 0) {
      await sleep(300, signal)
      return {
        ok: false,
        note: 'No hostiles inside perimeter radius.'
      }
    }

    const startedAt = Date.now()
    const result = await attackNearestHostileMob(bot, candidates, {
      allowCombat: true,
      signal
    })
    if (!result.ok) {
      return {
        ok: false,
        note: result.note || 'No valid hostile target.'
      }
    }

    if (Date.now() - startedAt > engagementSec * 1000) {
      return {
        ok: false,
        note: 'Engagement window elapsed before strike completion.'
      }
    }

    return {
      ok: true,
      note: `Militia engagement complete within ${engagementSec}s window.`
    }
  }
}

module.exports = {
  MilitiaDoctrine,
  isMilitiaRole,
  normalizeBotName
}
