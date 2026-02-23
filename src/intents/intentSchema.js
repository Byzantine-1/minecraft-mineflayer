const { ROLE_NAMES } = require('../behavior/botMind')
const { LAW_DEFINITIONS } = require('../behavior/laws')

const VALID_MODES = new Set(['auto', 'manual'])
const VALID_LAWS = new Set(Object.keys(LAW_DEFINITIONS))

function toBooleanSwitch(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'on' || normalized === 'true') {
    return true
  }
  if (normalized === 'off' || normalized === 'false') {
    return false
  }
  return null
}

function parseChatIntent(message) {
  const text = String(message || '').trim()
  if (!text.startsWith('!')) {
    return null
  }

  const parts = text.split(/\s+/)
  const lowerParts = parts.map((part) => String(part).toLowerCase())
  const root = parts[0]?.toLowerCase()

  if (root === '!mara') {
    if (lowerParts[1] === 'mode' && parts[2]) {
      return {
        type: 'mode.set',
        mode: String(parts[2]).toLowerCase()
      }
    }

    if (lowerParts[1] === 'role' && lowerParts[2] === 'set' && parts[3]) {
      return {
        type: 'role.set',
        role: String(parts[3]).toLowerCase()
      }
    }

    if (lowerParts[1] === 'law' && lowerParts[2] === 'list') {
      return {
        type: 'law.list'
      }
    }

    if (lowerParts[1] === 'law' && lowerParts[2] === 'set' && parts[3] && parts[4]) {
      const enabled = toBooleanSwitch(parts[4])
      return {
        type: 'law.set',
        lawName: String(parts[3]).toLowerCase(),
        enabled
      }
    }

    if (lowerParts[1] === 'stop') {
      return {
        type: 'stop'
      }
    }
  }

  if (root === '!all') {
    if (lowerParts[1] === 'council' && lowerParts[2] === 'decree') {
      const prefix = '!all council decree '
      return {
        type: 'council.decree',
        text: text.toLowerCase().startsWith(prefix)
          ? text.slice(prefix.length).trim()
          : parts.slice(3).join(' ').trim()
      }
    }

    if (lowerParts[1] === 'event' && lowerParts[2] === 'famine' && parts[3]) {
      return {
        type: 'event.famine',
        severity: Number(parts[3])
      }
    }

    if (lowerParts[1] === 'event' && lowerParts[2] === 'longnight' && parts[3]) {
      return {
        type: 'event.longnight',
        enabled: toBooleanSwitch(parts[3])
      }
    }

    if (lowerParts[1] === 'event' && lowerParts[2] === 'war' && parts[3] && parts[4] && parts[5]) {
      return {
        type: 'event.war',
        factionA: parts[3],
        factionB: parts[4],
        intensity: Number(parts[5])
      }
    }

    if (lowerParts[1] === 'economy' && lowerParts[2] === 'status') {
      return {
        type: 'economy.status'
      }
    }

    if (lowerParts[1] === 'settlement' && lowerParts[2] === 'status') {
      return {
        type: 'settlement.status'
      }
    }
  }

  return {
    type: 'unknown',
    raw: text
  }
}

function parseStdinIntent(line) {
  if (typeof line === 'string') {
    const trimmed = line.trim()
    if (!trimmed) {
      return null
    }

    if (trimmed.startsWith('!')) {
      return parseChatIntent(trimmed)
    }

    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      return {
        type: 'invalid',
        error: 'stdin payload is neither command text nor valid JSON'
      }
    }
    return parseStdinIntent(parsed)
  }

  if (!line || typeof line !== 'object') {
    return {
      type: 'invalid',
      error: 'stdin payload must be an object'
    }
  }

  if (typeof line.command === 'string') {
    return parseChatIntent(line.command)
  }

  return {
    ...line
  }
}

function validateIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    return {
      ok: false,
      error: 'Intent is missing or malformed.'
    }
  }

  const type = String(intent.type || '')
  if (!type) {
    return {
      ok: false,
      error: 'Intent type is required.'
    }
  }

  if (type === 'unknown') {
    return {
      ok: false,
      error: `Unknown command: ${intent.raw || '(empty)'}`
    }
  }

  if (type === 'invalid') {
    return {
      ok: false,
      error: intent.error || 'Invalid command payload.'
    }
  }

  if (type === 'mode.set') {
    if (!VALID_MODES.has(intent.mode)) {
      return {
        ok: false,
        error: `Mode must be one of: ${Array.from(VALID_MODES).join(', ')}`
      }
    }
    return {
      ok: true,
      value: { type, mode: intent.mode }
    }
  }

  if (type === 'role.set') {
    if (!ROLE_NAMES.includes(intent.role)) {
      return {
        ok: false,
        error: `Role must be one of: ${ROLE_NAMES.join(', ')}`
      }
    }
    return {
      ok: true,
      value: { type, role: intent.role }
    }
  }

  if (type === 'law.list') {
    return {
      ok: true,
      value: { type }
    }
  }

  if (type === 'law.set') {
    if (!VALID_LAWS.has(intent.lawName)) {
      return {
        ok: false,
        error: `Unknown law '${intent.lawName}'.`
      }
    }

    if (typeof intent.enabled !== 'boolean') {
      return {
        ok: false,
        error: `Law switch must be on/off.`
      }
    }

    return {
      ok: true,
      value: { type, lawName: intent.lawName, enabled: intent.enabled }
    }
  }

  if (type === 'council.decree') {
    const text = String(intent.text || '').trim()
    if (!text) {
      return {
        ok: false,
        error: 'Decree text is required.'
      }
    }
    return {
      ok: true,
      value: { type, text }
    }
  }

  if (type === 'event.famine') {
    const severity = Number(intent.severity)
    if (!Number.isFinite(severity) || severity < 0 || severity > 100) {
      return {
        ok: false,
        error: 'Famine value must be 0..100.'
      }
    }
    return {
      ok: true,
      value: {
        type,
        severity: Math.round(severity)
      }
    }
  }

  if (type === 'event.longnight') {
    if (typeof intent.enabled !== 'boolean') {
      return {
        ok: false,
        error: 'Longnight must be on/off.'
      }
    }
    return {
      ok: true,
      value: {
        type,
        enabled: intent.enabled
      }
    }
  }

  if (type === 'event.war') {
    const factionA = String(intent.factionA || '').trim()
    const factionB = String(intent.factionB || '').trim()
    const intensity = Number(intent.intensity)
    if (!factionA || !factionB) {
      return {
        ok: false,
        error: 'War command requires factionA and factionB.'
      }
    }
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 100) {
      return {
        ok: false,
        error: 'War intensity must be 0..100.'
      }
    }
    return {
      ok: true,
      value: {
        type,
        factionA,
        factionB,
        intensity: Math.round(intensity)
      }
    }
  }

  if (
    type === 'economy.status' ||
    type === 'settlement.status' ||
    type === 'stop'
  ) {
    return {
      ok: true,
      value: { type }
    }
  }

  return {
    ok: false,
    error: `Unsupported intent type '${type}'.`
  }
}

module.exports = {
  parseChatIntent,
  parseStdinIntent,
  validateIntent
}
