const fs = require('fs')
const crypto = require('crypto')
const readline = require('readline')

const CAPTURE_FILE = process.env.FAKE_ENGINE_CAPTURE_FILE || ''
const EMIT_NOISE = String(process.env.FAKE_ENGINE_NOISE || '1') !== '0'

function appendCapture(line) {
  if (!CAPTURE_FILE) {
    return
  }
  fs.appendFileSync(CAPTURE_FILE, `${line}\n`, 'utf8')
}

function toSpeaker(target) {
  const lower = String(target || '').toLowerCase()
  if (!lower) {
    return 'Agent'
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }

  return JSON.stringify(value)
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function parseExecutionHandoff(line) {
  if (typeof line !== 'string') {
    return null
  }

  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) {
    return null
  }

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return null
  }

  return parsed?.schemaVersion === 'execution-handoff.v1' ? parsed : null
}

function buildExecutionResult(handoff) {
  const actorId = String(handoff?.proposal?.actorId || 'mara').trim().toLowerCase() || 'mara'
  const townId = String(handoff?.proposal?.townId || 'alpha').trim() || 'alpha'
  const proposalType = String(handoff?.proposal?.type || 'UNKNOWN_PROPOSAL').trim() || 'UNKNOWN_PROPOSAL'
  const command = String(handoff?.command || '').trim()
  const executionId = `result_${hashValue({ handoffId: handoff?.handoffId || '', command, actorId, proposalType })}`

  return {
    type: 'execution-result.v1',
    schemaVersion: 1,
    executionId,
    resultId: executionId,
    handoffId: handoff?.handoffId || null,
    proposalId: handoff?.proposalId || null,
    idempotencyKey: handoff?.idempotencyKey || null,
    snapshotHash: handoff?.snapshotHash || null,
    decisionEpoch: Number.isInteger(handoff?.decisionEpoch) ? handoff.decisionEpoch : 0,
    actorId,
    townId,
    proposalType,
    command,
    authorityCommands: [command].filter(Boolean),
    status: 'executed',
    accepted: true,
    executed: true,
    reasonCode: 'EXECUTED',
    evaluation: {
      preconditions: {
        evaluated: true,
        passed: true,
        failures: []
      },
      staleCheck: {
        evaluated: true,
        passed: true,
        actualSnapshotHash: null,
        actualDecisionEpoch: Number.isInteger(handoff?.decisionEpoch) ? handoff.decisionEpoch : 0
      },
      duplicateCheck: {
        evaluated: true,
        duplicate: false,
        duplicateOf: null
      }
    },
    worldState: {
      postExecutionSnapshotHash: null,
      postExecutionDecisionEpoch: Number.isInteger(handoff?.decisionEpoch) ? handoff.decisionEpoch : 0
    },
    embodiment: {
      backendHint: 'mineflayer',
      actions: [
        {
          type: 'speech.say',
          text: `ack ${proposalType}`
        }
      ]
    }
  }
}

if (EMIT_NOISE) {
  console.log('--- WORLD ONLINE ---')
  console.log('Commands:')
  console.log('>')
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

rl.on('line', (line) => {
  const trimmed = String(line || '').trim()
  if (!trimmed) {
    return
  }

  appendCapture(trimmed)

  if (trimmed === 'exit') {
    console.log('World saved. Exiting.')
    setTimeout(() => process.exit(0), 25)
    return
  }

  if (trimmed.startsWith('talk ')) {
    const payload = trimmed.slice(5).trim()
    const firstSpace = payload.indexOf(' ')
    if (firstSpace <= 0) {
      console.log('INVALID TALK')
      return
    }
    const target = payload.slice(0, firstSpace).trim()
    const message = payload.slice(firstSpace + 1).trim()
    console.log(`${toSpeaker(target)}: ${message}`)
    if (EMIT_NOISE) {
      console.log('>')
    }
    return
  }

  if (trimmed.startsWith('god ')) {
    console.log(`GOD COMMAND APPLIED: ${trimmed.slice(4).trim()}`)
    return
  }

  const handoff = parseExecutionHandoff(trimmed)
  if (handoff) {
    console.log(JSON.stringify(buildExecutionResult(handoff)))
    return
  }

  console.log(`NOOP: ${trimmed}`)
})
