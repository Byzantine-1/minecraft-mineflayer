const fs = require('fs')
const path = require('path')

const DEFAULT_SETTLEMENT = {
  portal: {
    x: 0,
    y: 80,
    z: 0,
    dimension: 'overworld',
    radius: 10
  },
  returnShrine: {
    x: 10,
    y: 80,
    z: 10,
    dimension: 'overworld'
  },
  portalStatus: 'sealed',
  cooldownUntilDay: 0,
  currentDay: 0,
  pendingPermit: null,
  activeExpedition: null,
  laws: {
    netherPermitRequired: true,
    combatOnlyMilitia: true,
    noPrivatePortals: true
  }
}

const DEFAULT_ROSTER = {
  citizens: {
    mara: { alive: true, role: 'cleric', reputation: 50 },
    eli: { alive: true, role: 'militia', reputation: 50 },
    nox: { alive: true, role: 'trader', reputation: 50 }
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function deepMerge(base, override) {
  if (!isObject(base)) {
    return clone(override)
  }
  const merged = clone(base)
  if (!isObject(override)) {
    return merged
  }

  for (const key of Object.keys(override)) {
    const next = override[key]
    if (Array.isArray(next)) {
      merged[key] = clone(next)
      continue
    }
    if (isObject(next) && isObject(merged[key])) {
      merged[key] = deepMerge(merged[key], next)
      continue
    }
    merged[key] = next
  }

  return merged
}

function toSafeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
}

function resolveStateDir(explicitDir) {
  return path.resolve(explicitDir || process.env.STATE_DIR || path.resolve(process.cwd(), 'state'))
}

function resolveStatePaths(explicitDir) {
  const stateDir = resolveStateDir(explicitDir)
  return {
    stateDir,
    settlementFile: path.join(stateDir, 'settlement.json'),
    rosterFile: path.join(stateDir, 'roster.json'),
    logbookFile: path.join(stateDir, 'logbook.jsonl')
  }
}

function ensureStateDir(explicitDir) {
  const stateDir = resolveStateDir(explicitDir)
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true })
  }
  return stateDir
}

function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, content, 'utf8')
  fs.renameSync(tempPath, filePath)
}

function readJsonWithFallback(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!isObject(parsed)) {
      return clone(fallbackValue)
    }
    return parsed
  } catch (error) {
    return clone(fallbackValue)
  }
}

function writeJsonAtomic(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function sanitizeSettlement(rawValue) {
  const merged = deepMerge(DEFAULT_SETTLEMENT, rawValue)
  const validStatus = new Set(['sealed', 'open', 'cooldown'])
  const safeStatus = String(merged.portalStatus || '').toLowerCase()
  merged.portalStatus = validStatus.has(safeStatus) ? safeStatus : 'sealed'
  merged.cooldownUntilDay = Math.max(0, Math.floor(Number(merged.cooldownUntilDay) || 0))
  merged.currentDay = Math.max(0, Math.floor(Number(merged.currentDay) || 0))

  if (!isObject(merged.laws)) {
    merged.laws = clone(DEFAULT_SETTLEMENT.laws)
  }
  merged.laws.netherPermitRequired = merged.laws.netherPermitRequired !== false
  merged.laws.combatOnlyMilitia = merged.laws.combatOnlyMilitia !== false
  merged.laws.noPrivatePortals = merged.laws.noPrivatePortals !== false
  return merged
}

function sanitizeRoster(rawValue) {
  const merged = deepMerge(DEFAULT_ROSTER, rawValue)
  const citizens = {}
  for (const [name, rawCitizen] of Object.entries(merged.citizens || {})) {
    const key = toSafeName(name)
    if (!key) {
      continue
    }
    const citizen = isObject(rawCitizen) ? rawCitizen : {}
    citizens[key] = {
      alive: citizen.alive !== false,
      role: String(citizen.role || 'farmer').trim().toLowerCase() || 'farmer',
      reputation: Number.isFinite(Number(citizen.reputation))
        ? Number(citizen.reputation)
        : 50
    }
  }
  return { citizens }
}

function ensureStateFiles(explicitDir) {
  const { settlementFile, rosterFile, logbookFile } = resolveStatePaths(explicitDir)
  ensureStateDir(explicitDir)

  if (!fs.existsSync(settlementFile)) {
    writeJsonAtomic(settlementFile, clone(DEFAULT_SETTLEMENT))
  }
  if (!fs.existsSync(rosterFile)) {
    writeJsonAtomic(rosterFile, clone(DEFAULT_ROSTER))
  }
  if (!fs.existsSync(logbookFile)) {
    fs.writeFileSync(logbookFile, '', 'utf8')
  }
}

function getCurrentDay(nowMs = Date.now()) {
  return Math.max(0, Math.floor(Number(nowMs) / 86400000))
}

function loadSettlement(options = {}) {
  ensureStateFiles(options.stateDir)
  const { settlementFile } = resolveStatePaths(options.stateDir)
  const parsed = readJsonWithFallback(settlementFile, DEFAULT_SETTLEMENT)
  const sanitized = sanitizeSettlement(parsed)
  return sanitized
}

function saveSettlement(nextValue, options = {}) {
  ensureStateFiles(options.stateDir)
  const { settlementFile } = resolveStatePaths(options.stateDir)
  const sanitized = sanitizeSettlement(nextValue)
  writeJsonAtomic(settlementFile, sanitized)
  return sanitized
}

function loadRoster(options = {}) {
  ensureStateFiles(options.stateDir)
  const { rosterFile } = resolveStatePaths(options.stateDir)
  const parsed = readJsonWithFallback(rosterFile, DEFAULT_ROSTER)
  return sanitizeRoster(parsed)
}

function saveRoster(nextValue, options = {}) {
  ensureStateFiles(options.stateDir)
  const { rosterFile } = resolveStatePaths(options.stateDir)
  const sanitized = sanitizeRoster(nextValue)
  writeJsonAtomic(rosterFile, sanitized)
  return sanitized
}

function appendLog(entry, options = {}) {
  ensureStateFiles(options.stateDir)
  const { logbookFile } = resolveStatePaths(options.stateDir)
  const payload = {
    ts: entry?.ts || new Date().toISOString(),
    ...(isObject(entry) ? entry : { value: entry })
  }
  fs.appendFileSync(logbookFile, `${JSON.stringify(payload)}\n`, 'utf8')
  return payload
}

module.exports = {
  DEFAULT_SETTLEMENT,
  DEFAULT_ROSTER,
  resolveStateDir,
  resolveStatePaths,
  getCurrentDay,
  loadSettlement,
  saveSettlement,
  loadRoster,
  saveRoster,
  appendLog
}
