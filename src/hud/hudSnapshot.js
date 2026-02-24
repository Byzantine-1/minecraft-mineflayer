const fs = require('fs')
const path = require('path')

const { resolveStateDir } = require('../state/stateStore')

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function atomicWrite(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

function buildHudSnapshot({
  settlement,
  roster,
  worldStatus,
  reason = 'update',
  nowIso = new Date().toISOString()
}) {
  const citizens = Object.values(roster?.citizens || {})
  const alive = citizens.filter((citizen) => citizen.alive !== false).length
  const dead = citizens.filter((citizen) => citizen.alive === false).length
  const total = citizens.length

  const active = settlement?.activeExpedition || null
  const pending = settlement?.pendingPermit || null
  const events = worldStatus?.events || {}
  const war = events.war || {}

  return {
    ts: nowIso,
    reason: String(reason || 'update'),
    schemaVersion: 1,
    portalStatus: String(settlement?.portalStatus || 'sealed'),
    cooldownUntilDay: Math.max(0, Number(settlement?.cooldownUntilDay) || 0),
    currentDay: Math.max(0, Number(settlement?.currentDay) || 0),
    permit: pending
      ? {
        id: pending.permitId || null,
        blessed: pending.blessed === true,
        expiresAtDay: Math.max(0, Number(pending.expiresAtDay) || 0)
      }
      : null,
    expedition: active
      ? {
        status: String(active.status || 'active'),
        permitId: active.permitId || null,
        player: active.player || null
      }
      : null,
    roster: {
      alive,
      dead,
      total
    },
    threat: {
      famine: clamp(Number(events.famineSeverity) || 0, 0, 100),
      longNight: !!events.longNight,
      warIntensity: clamp(Number(war.intensity) || 0, 0, 100),
      raid: clamp(Number(events.raidSeverity) || 0, 0, 100)
    }
  }
}

function persistHudSnapshot(snapshot, { stateDir } = {}) {
  const dir = resolveStateDir(stateDir)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const filePath = path.join(dir, 'hudSnapshot.json')
  atomicWrite(filePath, `${JSON.stringify(snapshot, null, 2)}\n`)
  return { filePath, snapshot }
}

module.exports = {
  buildHudSnapshot,
  persistHudSnapshot
}
