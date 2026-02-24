const { appendLog } = require('../state/stateStore')

const EVENT_TYPES = Object.freeze([
  'permit_issued',
  'rite_performed',
  'portal_opened',
  'portal_sealed',
  'expedition_started',
  'expedition_failed',
  'expedition_ended',
  'npc_death',
  'replacement_appointed'
])

const EVENT_TYPE_SET = new Set(EVENT_TYPES)

function toIsoTimestamp(nowFn = () => Date.now()) {
  const raw = nowFn()
  if (raw instanceof Date) {
    return raw.toISOString()
  }
  if (typeof raw === 'string') {
    const asDate = new Date(raw)
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toISOString()
    }
  }
  const asDate = new Date(Number(raw))
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString()
  }
  return new Date().toISOString()
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return undefined
  }
  const normalized = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined) {
      continue
    }
    normalized[key] = value
  }
  return normalized
}

function sanitizeEvent(input, nowFn = () => Date.now()) {
  if (!input || typeof input !== 'object') {
    throw new Error('World event payload must be an object.')
  }

  const type = String(input.type || '').trim()
  if (!EVENT_TYPE_SET.has(type)) {
    throw new Error(`Unknown world event type '${type || '(empty)'}'.`)
  }

  const event = {
    type,
    ts: toIsoTimestamp(nowFn),
    source: 'npc-embodiment',
    schemaVersion: 1
  }

  const optionalFields = ['townId', 'permitId', 'expeditionId', 'actor']
  for (const key of optionalFields) {
    if (input[key] === undefined || input[key] === null) {
      continue
    }
    const value = String(input[key]).trim()
    if (value) {
      event[key] = value
    }
  }

  const details = sanitizeDetails(input.details)
  if (details && Object.keys(details).length > 0) {
    event.details = details
  }

  return event
}

function emitWorldEvent(event, { stateStore, nowFn } = {}) {
  const store = stateStore && typeof stateStore.appendLog === 'function'
    ? stateStore
    : { appendLog }
  const payload = sanitizeEvent(event, nowFn)
  return store.appendLog(payload)
}

module.exports = {
  EVENT_TYPES,
  emitWorldEvent
}
