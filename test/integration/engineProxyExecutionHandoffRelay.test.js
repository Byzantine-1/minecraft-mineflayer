const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BridgeRuntime, buildExecutionHandoffLine } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { waitFor } = require('../helpers/waitFor')

function stateFile(stateDir, fileName) {
  return path.join(stateDir, fileName)
}

test('engine_proxy submits execution-handoff.v1 JSON and relays canonical execution-result.v1 embodiment downstream', { timeout: 8000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-proxy-handoff-'))
  const capturePath = path.join(tempDir, 'engine-capture.log')
  const stateDir = path.join(tempDir, 'state')

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: path.resolve(__dirname, '../../scripts/fakeEngine.js'),
      ENGINE_CWD: path.resolve(__dirname, '../..'),
      BOT_NAMES: 'mara',
      CHAT_PREFIX: '!',
      STATE_DIR: stateDir,
      FAKE_ENGINE_CAPTURE_FILE: capturePath,
      FAKE_ENGINE_NOISE: '0'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    attachStdin: false,
    chatMinIntervalMs: 0,
    logFn: () => {}
  })

  const handoff = {
    schemaVersion: 'execution-handoff.v1',
    handoffId: `handoff_${'a'.repeat(64)}`,
    advisory: true,
    proposalId: `proposal_${'b'.repeat(64)}`,
    idempotencyKey: `proposal_${'b'.repeat(64)}`,
    snapshotHash: 'c'.repeat(64),
    decisionEpoch: 7,
    proposal: {
      type: 'PROJECT_ADVANCE',
      actorId: 'mara',
      townId: 'alpha',
      args: {
        projectId: 'pr_1'
      }
    },
    command: 'project advance alpha pr_1',
    executionRequirements: {
      expectedSnapshotHash: 'c'.repeat(64),
      expectedDecisionEpoch: 7,
      preconditions: [
        {
          kind: 'project_exists',
          targetId: 'pr_1'
        }
      ]
    }
  }

  try {
    runtime.startFromEnv()
    const maraBot = runtime.resolveBotRecord('mara').bot

    assert.equal(runtime.submitExecutionHandoff(handoff), true)

    await waitFor(
      () => maraBot.chats.includes('ack PROJECT_ADVANCE'),
      4000
    )

    const captured = fs.readFileSync(capturePath, 'utf8').trim().split(/\r?\n/)
    assert.equal(captured.length >= 1, true)
    assert.equal(captured[0], buildExecutionHandoffLine(handoff))
    assert.deepEqual(JSON.parse(captured[0]), handoff)

    assert.equal(fs.existsSync(stateFile(stateDir, 'settlement.json')), false)
    assert.equal(fs.existsSync(stateFile(stateDir, 'roster.json')), false)
    assert.equal(fs.existsSync(stateFile(stateDir, 'logbook.jsonl')), false)
  } finally {
    runtime.shutdown('proxy-execution-handoff')
  }
})

test('engine_proxy still supports legacy talk sender fallback during transition', { timeout: 8000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-proxy-legacy-fallback-'))
  const capturePath = path.join(tempDir, 'engine-capture.log')

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: path.resolve(__dirname, '../../scripts/fakeEngine.js'),
      ENGINE_CWD: path.resolve(__dirname, '../..'),
      BOT_NAMES: 'mara',
      CHAT_PREFIX: '!',
      FAKE_ENGINE_CAPTURE_FILE: capturePath,
      FAKE_ENGINE_NOISE: '0'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    attachStdin: false,
    chatMinIntervalMs: 0,
    logFn: () => {}
  })

  try {
    runtime.startFromEnv()
    const maraBot = runtime.resolveBotRecord('mara').bot

    assert.equal(runtime.submitEngineInput('talk mara hello fallback'), true)

    await waitFor(
      () => maraBot.chats.includes('hello fallback'),
      4000
    )

    const captured = fs.readFileSync(capturePath, 'utf8')
    assert.match(captured, /talk mara hello fallback/)
  } finally {
    runtime.shutdown('proxy-legacy-fallback')
  }
})
