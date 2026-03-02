const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BridgeRuntime,
  buildEngineInputLine,
  buildEngineTalkLine,
  buildExecutionHandoffLine,
  parseChatCommand
} = require('../../src/bridgeRuntime')

test('parseChatCommand parses prefixed mara chat correctly', { timeout: 1000 }, () => {
  assert.deepEqual(parseChatCommand('!mara hello', '!'), {
    target: 'mara',
    text: 'hello'
  })
})

test('parseChatCommand trims and normalizes spacing', { timeout: 1000 }, () => {
  assert.deepEqual(parseChatCommand('!eli   what   now', '!'), {
    target: 'eli',
    text: 'what now'
  })
})

test('parseChatCommand drops !all autonomous-style commands in proxy parsing', { timeout: 1000 }, () => {
  assert.equal(parseChatCommand('!all scan', '!'), null)
})

test('parseChatCommand ignores non-prefixed messages when prefix is required', { timeout: 1000 }, () => {
  assert.equal(parseChatCommand('mara hello', '!'), null)
})

test('BridgeRuntime.parseProxyIncomingChat rejects unknown targets', { timeout: 1000 }, () => {
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      CHAT_PREFIX: '!',
      ENGINE_SCRIPT: 'fake-engine.js'
    },
    logFn: () => {}
  })
  runtime.botNameIndex.set('mara', 'mara')

  assert.equal(runtime.parseProxyIncomingChat('!alex hello'), null)
  assert.deepEqual(runtime.parseProxyIncomingChat('!mara hello there'), {
    target: 'mara',
    text: 'hello there'
  })
})

test('buildEngineTalkLine emits deterministic engine command', { timeout: 1000 }, () => {
  assert.equal(buildEngineTalkLine('MARA', 'hello world'), 'talk mara hello world')
  assert.equal(buildEngineTalkLine('mara', ''), null)
})

test('buildExecutionHandoffLine emits deterministic line-delimited JSON for valid handoffs', { timeout: 1000 }, () => {
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

  const first = buildExecutionHandoffLine(handoff)
  const second = buildExecutionHandoffLine({
    proposal: {
      townId: 'alpha',
      args: { projectId: 'pr_1' },
      actorId: 'mara',
      type: 'PROJECT_ADVANCE'
    },
    decisionEpoch: 7,
    command: 'project advance alpha pr_1',
    idempotencyKey: `proposal_${'b'.repeat(64)}`,
    advisory: true,
    handoffId: `handoff_${'a'.repeat(64)}`,
    executionRequirements: {
      preconditions: [{ kind: 'project_exists', targetId: 'pr_1' }],
      expectedDecisionEpoch: 7,
      expectedSnapshotHash: 'c'.repeat(64)
    },
    proposalId: `proposal_${'b'.repeat(64)}`,
    schemaVersion: 'execution-handoff.v1',
    snapshotHash: 'c'.repeat(64)
  })

  assert.equal(first, second)
  assert.deepEqual(JSON.parse(first), handoff)
})

test('buildEngineInputLine preserves legacy command strings during transition', { timeout: 1000 }, () => {
  assert.equal(buildEngineInputLine(' talk mara hello there '), 'talk mara hello there')
  assert.equal(buildEngineInputLine('god mayor accept alpha'), 'god mayor accept alpha')
})
