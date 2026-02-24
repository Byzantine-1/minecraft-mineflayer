const crypto = require('crypto')

const {
  loadSettlement,
  saveSettlement,
  getCurrentDay
} = require('../state/stateStore')
const { emitWorldEvent } = require('../events/worldEvents')

function createPermitId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const rand = Math.round(Math.random() * 1e9).toString(36)
  return `permit-${Date.now().toString(36)}-${rand}`
}

function normalizeName(value) {
  return String(value || '').trim()
}

function buildStateStoreAdapter(stateDir) {
  return {
    appendLog(entry) {
      const { appendLog } = require('../state/stateStore')
      return appendLog(entry, { stateDir })
    }
  }
}

class ExpeditionController {
  constructor({
    runtime = null,
    stateDir,
    nowFn = () => Date.now(),
    currentDayFn = (nowMs) => getCurrentDay(nowMs),
    cooldownDaysFail = Number(process.env.COOLDOWN_DAYS_FAIL) || 3,
    cooldownDaysSuccess = Number(process.env.COOLDOWN_DAYS_SUCCESS) || 1,
    permitTtlDays = Number(process.env.PERMIT_TTL_DAYS) || 1
  } = {}) {
    this.runtime = runtime
    this.stateDir = stateDir
    this.nowFn = nowFn
    this.currentDayFn = currentDayFn
    this.cooldownDaysFail = Math.max(1, Math.floor(cooldownDaysFail))
    this.cooldownDaysSuccess = Math.max(1, Math.floor(cooldownDaysSuccess))
    this.permitTtlDays = Math.max(1, Math.floor(permitTtlDays))
  }

  nowIso() {
    return new Date(this.nowFn()).toISOString()
  }

  readSettlement() {
    return loadSettlement({ stateDir: this.stateDir })
  }

  writeSettlement(next) {
    return saveSettlement(next, { stateDir: this.stateDir })
  }

  emitEvent(event) {
    if (this.runtime && typeof this.runtime.emitWorldEvent === 'function') {
      return this.runtime.emitWorldEvent(event)
    }
    return emitWorldEvent(event, {
      stateStore: buildStateStoreAdapter(this.stateDir),
      nowFn: this.nowFn
    })
  }

  syncCurrentDay(settlement) {
    const derived = this.currentDayFn(this.nowFn())
    const current = Math.max(
      Math.floor(Number(settlement.currentDay) || 0),
      Math.floor(Number(derived) || 0)
    )
    settlement.currentDay = current
    return current
  }

  issuePermit(reason, issuedBy = 'system') {
    const safeReason = String(reason || '').trim()
    if (!safeReason) {
      return { ok: false, error: 'Permit reason is required.' }
    }

    const settlement = this.readSettlement()
    const currentDay = this.syncCurrentDay(settlement)
    const permitId = createPermitId()
    const pendingPermit = {
      permitId,
      reason: safeReason,
      issuedBy: normalizeName(issuedBy) || 'system',
      blessed: false,
      expiresAtDay: currentDay + this.permitTtlDays
    }

    settlement.pendingPermit = pendingPermit
    this.writeSettlement(settlement)
    this.emitEvent({
      type: 'permit_issued',
      permitId,
      actor: pendingPermit.issuedBy,
      details: {
        reason: safeReason,
        expiresAtDay: pendingPermit.expiresAtDay
      }
    })
    return { ok: true, permit: pendingPermit }
  }

  blessPermit(permitId, actor = 'system') {
    const targetId = normalizeName(permitId)
    const settlement = this.readSettlement()
    this.syncCurrentDay(settlement)
    const permit = settlement.pendingPermit

    if (!permit) {
      return { ok: false, error: 'No pending permit exists.' }
    }
    if (permit.permitId !== targetId) {
      return { ok: false, error: 'Permit ID does not match pending permit.' }
    }
    if (settlement.currentDay > Number(permit.expiresAtDay)) {
      return { ok: false, error: 'Permit has expired.' }
    }

    permit.blessed = true
    permit.blessedBy = normalizeName(actor) || 'system'
    permit.blessedAtTs = this.nowIso()
    settlement.pendingPermit = permit
    this.writeSettlement(settlement)
    this.emitEvent({
      type: 'rite_performed',
      permitId: targetId,
      actor: permit.blessedBy,
      details: {
        rite: 'warding'
      }
    })

    return { ok: true, permit }
  }

  openPortal(permitId, actor = 'system') {
    const targetId = normalizeName(permitId)
    const settlement = this.readSettlement()
    const currentDay = this.syncCurrentDay(settlement)
    const permit = settlement.pendingPermit

    if (!permit) {
      return { ok: false, error: 'No pending permit exists.' }
    }
    if (permit.permitId !== targetId) {
      return { ok: false, error: 'Permit ID does not match pending permit.' }
    }
    if (!permit.blessed) {
      return { ok: false, error: 'Permit must be blessed before portal open.' }
    }
    if (currentDay > Number(permit.expiresAtDay)) {
      return { ok: false, error: 'Permit has expired.' }
    }
    if (settlement.portalStatus === 'open') {
      return { ok: false, error: 'Portal is already open.' }
    }
    if (
      settlement.portalStatus === 'cooldown' &&
      currentDay < Number(settlement.cooldownUntilDay || 0)
    ) {
      return {
        ok: false,
        error: `Portal cooldown active until day ${settlement.cooldownUntilDay}.`
      }
    }

    settlement.portalStatus = 'open'
    settlement.cooldownUntilDay = 0
    this.writeSettlement(settlement)
    this.emitEvent({
      type: 'portal_opened',
      permitId: targetId,
      actor: normalizeName(actor) || 'system',
      details: {
        cooldownUntilDay: 0
      }
    })
    return { ok: true, portalStatus: settlement.portalStatus }
  }

  sealPortal(actor = 'system') {
    const settlement = this.readSettlement()
    this.syncCurrentDay(settlement)
    const expedition = settlement.activeExpedition

    if (expedition && expedition.status !== 'active') {
      settlement.portalStatus = 'cooldown'
    } else {
      settlement.portalStatus = 'sealed'
      settlement.cooldownUntilDay = 0
    }

    this.writeSettlement(settlement)
    this.emitEvent({
      type: 'portal_sealed',
      actor: normalizeName(actor) || 'system',
      details: {
        portalStatus: settlement.portalStatus,
        cooldownUntilDay: settlement.cooldownUntilDay
      }
    })
    return {
      ok: true,
      portalStatus: settlement.portalStatus,
      cooldownUntilDay: settlement.cooldownUntilDay
    }
  }

  startExpedition(permitId, playerName, botNames = []) {
    const targetId = normalizeName(permitId)
    const player = normalizeName(playerName)
    if (!player) {
      return { ok: false, error: 'Player name is required.' }
    }

    const settlement = this.readSettlement()
    const currentDay = this.syncCurrentDay(settlement)
    const permit = settlement.pendingPermit

    if (settlement.portalStatus !== 'open') {
      return { ok: false, error: 'Portal must be open before expedition start.' }
    }
    if (!permit || permit.permitId !== targetId) {
      return { ok: false, error: 'Valid pending permit is required.' }
    }
    if (!permit.blessed) {
      return { ok: false, error: 'Permit must be blessed.' }
    }
    if (currentDay > Number(permit.expiresAtDay)) {
      return { ok: false, error: 'Permit has expired.' }
    }
    if (settlement.activeExpedition?.status === 'active') {
      return { ok: false, error: 'An expedition is already active.' }
    }

    const expedition = {
      permitId: targetId,
      status: 'active',
      player,
      bots: botNames.map((name) => String(name).toLowerCase()),
      startedAtTs: this.nowIso(),
      endedAtTs: null,
      failReason: null
    }

    settlement.activeExpedition = expedition
    this.writeSettlement(settlement)
    this.emitEvent({
      type: 'expedition_started',
      permitId: targetId,
      expeditionId: targetId,
      actor: player,
      details: {
        player,
        bots: expedition.bots
      }
    })

    if (this.runtime?.militiaDoctrine) {
      if (typeof this.runtime.militiaDoctrine.musterToPortal === 'function') {
        this.runtime.militiaDoctrine.musterToPortal({
          portal: settlement.portal
        })
      }
      if (typeof this.runtime.militiaDoctrine.holdPerimeter === 'function') {
        this.runtime.militiaDoctrine.holdPerimeter({
          portal: settlement.portal,
          durationSec: 45
        })
      }
    }

    return { ok: true, expedition }
  }

  failExpedition(failReason = 'player_death', actor = 'system') {
    const reason = normalizeName(failReason) || 'player_death'
    const settlement = this.readSettlement()
    const currentDay = this.syncCurrentDay(settlement)
    const expedition = settlement.activeExpedition

    if (!expedition || expedition.status !== 'active') {
      return { ok: false, error: 'No active expedition to fail.' }
    }

    expedition.status = 'failed'
    expedition.endedAtTs = this.nowIso()
    expedition.failReason = reason
    settlement.activeExpedition = expedition
    settlement.portalStatus = 'cooldown'
    settlement.cooldownUntilDay = currentDay + this.cooldownDaysFail
    this.writeSettlement(settlement)

    this.emitEvent({
      type: 'expedition_failed',
      permitId: expedition.permitId,
      actor: normalizeName(actor) || 'system',
      expeditionId: expedition.permitId,
      details: {
        reason,
        cooldownUntilDay: settlement.cooldownUntilDay
      }
    })

    if (this.runtime?.stopAllActiveTasks) {
      this.runtime.stopAllActiveTasks('expedition_failed')
    }
    if (this.runtime?.militiaDoctrine) {
      this.runtime.militiaDoctrine.retreatToRally()
    }
    if (this.runtime?.broadcast) {
      this.runtime.broadcast(`[town] Expedition failed (${reason}). Retreat to shrine.`)
    }

    return {
      ok: true,
      expedition,
      portalStatus: settlement.portalStatus,
      cooldownUntilDay: settlement.cooldownUntilDay
    }
  }

  endExpedition(outcome = 'success', actor = 'system') {
    const normalized = String(outcome || 'success').trim().toLowerCase()
    const status = normalized === 'failed' ? 'failed' : 'success'

    const settlement = this.readSettlement()
    const currentDay = this.syncCurrentDay(settlement)
    const expedition = settlement.activeExpedition
    if (!expedition || expedition.status !== 'active') {
      return { ok: false, error: 'No active expedition to end.' }
    }

    expedition.status = status
    expedition.endedAtTs = this.nowIso()
    expedition.failReason = status === 'failed' ? 'ended_failed' : null
    settlement.activeExpedition = expedition
    settlement.portalStatus = 'cooldown'
    settlement.cooldownUntilDay = currentDay + (
      status === 'failed'
        ? this.cooldownDaysFail
        : this.cooldownDaysSuccess
    )
    this.writeSettlement(settlement)

    this.emitEvent({
      type: 'expedition_ended',
      permitId: expedition.permitId,
      actor: normalizeName(actor) || 'system',
      expeditionId: expedition.permitId,
      details: {
        status,
        cooldownUntilDay: settlement.cooldownUntilDay
      }
    })

    if (this.runtime?.broadcast) {
      this.runtime.broadcast(
        `[town] Expedition ${status}. cooldownUntilDay=${settlement.cooldownUntilDay}`
      )
    }

    return {
      ok: true,
      expedition,
      portalStatus: settlement.portalStatus,
      cooldownUntilDay: settlement.cooldownUntilDay
    }
  }

  getStatus() {
    const settlement = this.readSettlement()
    this.syncCurrentDay(settlement)
    return {
      portalStatus: settlement.portalStatus,
      cooldownUntilDay: settlement.cooldownUntilDay,
      currentDay: settlement.currentDay,
      pendingPermit: settlement.pendingPermit,
      activeExpedition: settlement.activeExpedition
    }
  }
}

module.exports = {
  ExpeditionController
}
