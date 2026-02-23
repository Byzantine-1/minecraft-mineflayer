const test = require('node:test')
const assert = require('node:assert/strict')

const { BridgeRuntime, parseChatCommand, buildEngineTalkLine } = require('../../src/bridgeRuntime')

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
