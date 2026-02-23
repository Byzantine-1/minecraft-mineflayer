const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveBridgeMode } = require('../../src/bridgeRuntime')

test('resolveBridgeMode defaults to autonomous when BRIDGE_MODE is missing', { timeout: 1000 }, () => {
  assert.equal(resolveBridgeMode({}), 'autonomous')
})

test('resolveBridgeMode returns autonomous for explicit autonomous value', { timeout: 1000 }, () => {
  assert.equal(resolveBridgeMode({ BRIDGE_MODE: 'autonomous' }), 'autonomous')
})

test('resolveBridgeMode returns engine_proxy for explicit proxy values', { timeout: 1000 }, () => {
  assert.equal(resolveBridgeMode({ BRIDGE_MODE: 'engine_proxy' }), 'engine_proxy')
  assert.equal(resolveBridgeMode({ BRIDGE_MODE: 'proxy' }), 'engine_proxy')
})

test('resolveBridgeMode falls back to autonomous for invalid values', { timeout: 1000 }, () => {
  assert.equal(resolveBridgeMode({ BRIDGE_MODE: 'invalid-mode' }), 'autonomous')
})
