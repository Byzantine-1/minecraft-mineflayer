const EXECUTION_RESULT_TYPE = 'execution-result.v1'
const EMBODIMENT_REQUEST_TYPE = 'embodiment-request.v1'
const EMBODIMENT_RESULT_TYPE = 'embodiment-result.v1'
const EMBODIMENT_EVENT_TYPE = 'embodiment-event.v1'
const EMBODIMENT_SCHEMA_VERSION = 1

const ACTION_TYPES = Object.freeze([
  'speech.say',
  'movement.intent',
  'interaction.intent',
  'ambient.perform'
])

const MOVEMENT_MODES = new Set(['approach', 'follow', 'face', 'stop'])
const INTERACTION_KINDS = new Set([
  'swing_arm',
  'activate_item',
  'use_entity',
  'use_block'
])
const AMBIENT_GESTURES = new Set(['jump', 'crouch', 'swing_arm', 'look', 'wait'])
const ACTION_STATUS_SET = new Set(['applied', 'ignored', 'failed'])

function compactObject(input) {
  const out = {}
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined) {
      continue
    }
    out[key] = value
  }
  return out
}

function sanitizeString(value, options = {}) {
  if (value === undefined || value === null) {
    return undefined
  }
  const maxLength = Number(options.maxLength) || 120
  let text = String(value).trim()
  if (!text) {
    return undefined
  }
  if (options.lowercase) {
    text = text.toLowerCase()
  }
  return text.slice(0, maxLength)
}

function sanitizeNumber(value, options = {}) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return undefined
  }

  const min = Number.isFinite(Number(options.min)) ? Number(options.min) : null
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : null
  let next = num
  if (min !== null) {
    next = Math.max(min, next)
  }
  if (max !== null) {
    next = Math.min(max, next)
  }
  if (options.integer) {
    next = Math.round(next)
  }
  return next
}

function toIsoTimestamp(value = Date.now()) {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  const parsed = new Date(Number(value))
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }
  return new Date().toISOString()
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4 || value === undefined) {
    return undefined
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    const out = value
      .map((entry) => sanitizeMetadata(entry, depth + 1))
      .filter((entry) => entry !== undefined)
    return out.length > 0 ? out : undefined
  }

  if (typeof value !== 'object') {
    return undefined
  }

  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    const next = sanitizeMetadata(entry, depth + 1)
    if (next === undefined) {
      continue
    }
    out[key] = next
  }

  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeFacing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const yaw = sanitizeNumber(value.yaw)
  const pitch = sanitizeNumber(value.pitch)
  if (yaw === undefined || pitch === undefined) {
    return undefined
  }
  return { yaw, pitch }
}

function sanitizePositionTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const x = sanitizeNumber(value.x)
  const y = sanitizeNumber(value.y)
  const z = sanitizeNumber(value.z)
  if (x === undefined || y === undefined || z === undefined) {
    return undefined
  }
  return compactObject({
    kind: 'position',
    x,
    y,
    z,
    radius: sanitizeNumber(value.radius, { min: 0, max: 16 })
  })
}

function sanitizeEntityTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const entityId = sanitizeString(value.entityId ?? value.id, { maxLength: 64 })
  const name = sanitizeString(value.name ?? value.username, {
    maxLength: 64,
    lowercase: true
  })
  if (!entityId && !name) {
    return undefined
  }

  return compactObject({
    kind: 'entity',
    entityId,
    name,
    radius: sanitizeNumber(value.radius, { min: 0, max: 12 })
  })
}

function sanitizeTarget(value) {
  return sanitizePositionTarget(value) || sanitizeEntityTarget(value)
}

function normalizeActionId(actionId, fallback, index) {
  return sanitizeString(actionId, { maxLength: 80 }) || `${fallback}-${index + 1}`
}

function resolveActionActorId(action, actorId) {
  return sanitizeString(action?.actorId ?? actorId, {
    maxLength: 32,
    lowercase: true
  })
}

function sanitizeSpeechAction(action, index, actorId) {
  const text = sanitizeString(action.text ?? action.message, { maxLength: 240 })
  if (!text) {
    return null
  }

  return {
    actionId: normalizeActionId(action.actionId, 'speech', index),
    type: 'speech.say',
    actorId: resolveActionActorId(action, actorId),
    text,
    channel: sanitizeString(action.channel, { maxLength: 24, lowercase: true }) || 'public',
    delivery: {
      dedupe: action.delivery?.dedupe === true || action.dedupe === true,
      bypassRateLimit:
        action.delivery?.bypassRateLimit === true || action.bypassRateLimit === true
    }
  }
}

function sanitizeMovementAction(action, index, actorId) {
  const mode = sanitizeString(action.mode, { maxLength: 24, lowercase: true }) || 'approach'
  if (!MOVEMENT_MODES.has(mode)) {
    return null
  }

  if (mode === 'stop') {
    return compactObject({
      actionId: normalizeActionId(action.actionId, 'movement', index),
      type: 'movement.intent',
      actorId: resolveActionActorId(action, actorId),
      mode
    })
  }

  const target = sanitizeTarget(action.target ?? action.destination)
  if (!target) {
    return null
  }

  return compactObject({
    actionId: normalizeActionId(action.actionId, 'movement', index),
    type: 'movement.intent',
    actorId: resolveActionActorId(action, actorId),
    mode,
    target
  })
}

function sanitizeInteractionAction(action, index, actorId) {
  const interaction = sanitizeString(action.interaction ?? action.intent, {
    maxLength: 32,
    lowercase: true
  })
  if (!INTERACTION_KINDS.has(interaction)) {
    return null
  }

  const target = sanitizeTarget(action.target)
  if (
    (interaction === 'use_entity' || interaction === 'use_block') &&
    !target
  ) {
    return null
  }

  return compactObject({
    actionId: normalizeActionId(action.actionId, 'interaction', index),
    type: 'interaction.intent',
    actorId: resolveActionActorId(action, actorId),
    interaction,
    hand: sanitizeString(action.hand, { maxLength: 12, lowercase: true }) || 'right',
    target
  })
}

function sanitizeAmbientAction(action, index, actorId) {
  const gesture = sanitizeString(action.gesture, { maxLength: 24, lowercase: true })
  if (!AMBIENT_GESTURES.has(gesture)) {
    return null
  }

  const rawStyle = sanitizeString(action.style, { maxLength: 24, lowercase: true })
  const style = rawStyle === 'ceremonial' ? 'ceremonial' : 'ambient'

  return compactObject({
    actionId: normalizeActionId(action.actionId, 'ambient', index),
    type: 'ambient.perform',
    actorId: resolveActionActorId(action, actorId),
    gesture,
    style,
    durationMs: sanitizeNumber(action.durationMs, {
      min: 0,
      max: 5000,
      integer: true
    }) ?? 400,
    target: sanitizePositionTarget(action.target),
    facing: sanitizeFacing(action.facing)
  })
}

function sanitizeEmbodimentAction(action, index, actorId) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return null
  }

  const type = sanitizeString(action.type, { maxLength: 48, lowercase: true })
  if (type === 'speech.say') {
    return sanitizeSpeechAction(action, index, actorId)
  }
  if (type === 'movement.intent') {
    return sanitizeMovementAction(action, index, actorId)
  }
  if (type === 'interaction.intent') {
    return sanitizeInteractionAction(action, index, actorId)
  }
  if (type === 'ambient.perform') {
    return sanitizeAmbientAction(action, index, actorId)
  }
  return null
}

function isAcceptedExecutionResult(input) {
  if (!input || typeof input !== 'object') {
    return false
  }

  return (
    input.accepted === true ||
    String(input.status || '').trim().toLowerCase() === 'accepted' ||
    input.decision?.accepted === true
  )
}

function resolveActorId(input) {
  return sanitizeString(
    input.actorId ??
      input.actor?.id ??
      input.botName ??
      input.bot?.name,
    { maxLength: 32, lowercase: true }
  )
}

function resolveEmbodimentActions(input) {
  if (Array.isArray(input?.embodiment?.actions)) {
    return input.embodiment.actions
  }
  if (Array.isArray(input?.actions)) {
    return input.actions
  }
  return []
}

function buildEmbodimentRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Execution result payload must be an object.')
  }

  const type = sanitizeString(input.type, { maxLength: 64 })
  if (type !== EXECUTION_RESULT_TYPE) {
    throw new Error(`Unsupported execution result type '${type || '(empty)'}'.`)
  }

  const actorId = resolveActorId(input)
  const actions = resolveEmbodimentActions(input)
    .map((action, index) => sanitizeEmbodimentAction(action, index, actorId))
    .filter(Boolean)

  return compactObject({
    type: EMBODIMENT_REQUEST_TYPE,
    schemaVersion: EMBODIMENT_SCHEMA_VERSION,
    sourceType: EXECUTION_RESULT_TYPE,
    executionId: sanitizeString(input.executionId ?? input.id, { maxLength: 96 }),
    proposalId: sanitizeString(
      input.proposalId ?? input.proposal?.id ?? input.decision?.proposalId,
      { maxLength: 96 }
    ),
    actorId,
    accepted: isAcceptedExecutionResult(input),
    acceptedAt: input.acceptedAt ? toIsoTimestamp(input.acceptedAt) : undefined,
    backendHint: sanitizeString(
      input.embodiment?.backendHint ?? input.embodiment?.backend,
      { maxLength: 32, lowercase: true }
    ),
    actions,
    metadata: sanitizeMetadata(input.embodiment?.metadata ?? input.metadata)
  })
}

function parseExecutionResultLine(line) {
  if (typeof line !== 'string') {
    return null
  }
  let trimmed = line.trim()
  while (trimmed.startsWith('>')) {
    trimmed = trimmed.slice(1).trimStart()
  }
  if (!trimmed.startsWith('{')) {
    return null
  }

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return null
  }

  if (parsed?.type !== EXECUTION_RESULT_TYPE) {
    return null
  }
  return parsed
}

function sanitizeActionOutcome(outcome, index) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    return null
  }

  const status = sanitizeString(outcome.status, { maxLength: 24, lowercase: true })
  if (!ACTION_STATUS_SET.has(status)) {
    return null
  }

  return compactObject({
    actionId: normalizeActionId(outcome.actionId, 'action', index),
    type: sanitizeString(outcome.type, { maxLength: 48, lowercase: true }),
    status,
    note: sanitizeString(outcome.note, { maxLength: 240 }),
    backendRef: sanitizeString(outcome.backendRef, { maxLength: 120 }),
    details: sanitizeMetadata(outcome.details)
  })
}

function summarizeOutcomes(outcomes) {
  const summary = {
    applied: 0,
    ignored: 0,
    failed: 0
  }

  for (const outcome of outcomes) {
    if (!outcome || !Object.prototype.hasOwnProperty.call(summary, outcome.status)) {
      continue
    }
    summary[outcome.status] += 1
  }

  return summary
}

function resolveResultStatus(request, outcomes, error) {
  if (error) {
    return 'failed'
  }
  if (!request?.accepted) {
    return 'ignored'
  }
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return 'ignored'
  }

  const summary = summarizeOutcomes(outcomes)
  if (summary.failed > 0 && summary.applied > 0) {
    return 'partial'
  }
  if (summary.failed > 0) {
    return 'failed'
  }
  if (summary.applied > 0) {
    return 'applied'
  }
  return 'ignored'
}

function createEmbodimentResult({
  request,
  backend = 'mineflayer',
  outcomes = [],
  startedAt,
  finishedAt,
  error
} = {}) {
  const normalizedOutcomes = outcomes
    .map((outcome, index) => sanitizeActionOutcome(outcome, index))
    .filter(Boolean)
  const summary = summarizeOutcomes(normalizedOutcomes)
  const status = resolveResultStatus(request, normalizedOutcomes, error)

  return compactObject({
    type: EMBODIMENT_RESULT_TYPE,
    schemaVersion: EMBODIMENT_SCHEMA_VERSION,
    backend: sanitizeString(backend, { maxLength: 32, lowercase: true }) || 'mineflayer',
    sourceType: request?.sourceType || EXECUTION_RESULT_TYPE,
    executionId: sanitizeString(request?.executionId, { maxLength: 96 }),
    proposalId: sanitizeString(request?.proposalId, { maxLength: 96 }),
    actorId: sanitizeString(request?.actorId, { maxLength: 32, lowercase: true }),
    accepted: request?.accepted === true,
    status,
    startedAt: toIsoTimestamp(startedAt),
    finishedAt: toIsoTimestamp(finishedAt),
    actionCount: Array.isArray(request?.actions) ? request.actions.length : 0,
    summary,
    outcomes: normalizedOutcomes,
    error: error
      ? {
          message: sanitizeString(error.message || String(error), { maxLength: 240 }) || 'Unknown error'
        }
      : undefined
  })
}

function createEmbodimentEvent({
  event,
  backend = 'mineflayer',
  request,
  outcome,
  result,
  ts
} = {}) {
  return compactObject({
    type: EMBODIMENT_EVENT_TYPE,
    schemaVersion: EMBODIMENT_SCHEMA_VERSION,
    ts: toIsoTimestamp(ts),
    event: sanitizeString(event, { maxLength: 48, lowercase: true }),
    backend: sanitizeString(backend, { maxLength: 32, lowercase: true }) || 'mineflayer',
    executionId: sanitizeString(
      result?.executionId ?? request?.executionId,
      { maxLength: 96 }
    ),
    proposalId: sanitizeString(
      result?.proposalId ?? request?.proposalId,
      { maxLength: 96 }
    ),
    actorId: sanitizeString(
      result?.actorId ?? request?.actorId,
      { maxLength: 32, lowercase: true }
    ),
    actionId: sanitizeString(outcome?.actionId, { maxLength: 80 }),
    actionType: sanitizeString(outcome?.type, { maxLength: 48, lowercase: true }),
    status: sanitizeString(outcome?.status ?? result?.status, {
      maxLength: 24,
      lowercase: true
    }),
    note: sanitizeString(outcome?.note, { maxLength: 240 }),
    summary: result?.summary
  })
}

module.exports = {
  ACTION_TYPES,
  EMBODIMENT_EVENT_TYPE,
  EMBODIMENT_REQUEST_TYPE,
  EMBODIMENT_RESULT_TYPE,
  EMBODIMENT_SCHEMA_VERSION,
  EXECUTION_RESULT_TYPE,
  buildEmbodimentRequest,
  createEmbodimentEvent,
  createEmbodimentResult,
  parseExecutionResultLine
}
