const test = require('node:test')
const assert = require('node:assert/strict')

const { installRuntimeProcessHandlers } = require('../../src/bridgeRuntime')

test('installRuntimeProcessHandlers is test-mode gated and idempotent', { timeout: 1000 }, () => {
  const disabled = installRuntimeProcessHandlers({ NODE_ENV: 'production' })
  assert.equal(disabled, false)

  const enabledFirst = installRuntimeProcessHandlers({ NODE_ENV: 'test' })
  const enabledSecond = installRuntimeProcessHandlers({ NODE_ENV: 'test' })
  assert.equal(enabledFirst, true)
  assert.equal(enabledSecond, true)
})
