const test = require('node:test')
const assert = require('node:assert/strict')

const { runRelayExecutionCheck } = require('../scripts/relayExecutionCheck')

test('engine_proxy relays a canonical execution handoff/result against a real engine child process', { timeout: 45000 }, async () => {
  const result = await runRelayExecutionCheck()

  assert.equal(result.capturedLiveFromChildProcess, true)
  assert.equal(result.deterministicReplayVerified, true)
  assert.equal(result.result.type, 'execution-result.v1')
  assert.equal(result.result.schemaVersion, 1)
  assert.equal(result.result.status, 'executed')
  assert.equal(result.result.accepted, true)
  assert.equal(result.result.executed, true)
  assert.equal(result.completionEvent?.status, 'ignored')
  assert.deepEqual(result.pendingExecutions, [])
})
