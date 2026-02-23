const test = require('node:test')
const assert = require('node:assert/strict')

const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')

function createEngineProxyStub(counter) {
  const stub = {
    process: { killed: false },
    exitSent: false,
    sendLine(line) {
      counter.lines.push(line)
      return true
    },
    sendExit() {
      if (!stub.exitSent) {
        stub.exitSent = true
        counter.exitWrites += 1
      }
      return true
    },
    shutdown() {
      counter.shutdownCalls += 1
      stub.process.killed = true
    },
    isExitSent() {
      return stub.exitSent
    }
  }
  return stub
}

test('proxy shutdown sends engine exit exactly once', { timeout: 2000 }, () => {
  const counter = { starts: 0, exitWrites: 0, shutdownCalls: 0, lines: [] }
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: 'fake-engine.js',
      BOT_NAMES: 'mara'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    startEngineProxyImpl: () => {
      counter.starts += 1
      return createEngineProxyStub(counter)
    },
    attachStdin: false,
    logFn: () => {},
    chatMinIntervalMs: 0
  })

  runtime.startFromEnv()
  runtime.shutdown('first')
  runtime.shutdown('second')

  assert.equal(counter.starts, 1)
  assert.equal(counter.exitWrites, 1)
  assert.equal(counter.shutdownCalls, 1)
})

test('autonomous shutdown does not try to send engine exit', { timeout: 2000 }, () => {
  const counter = { starts: 0 }
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'autonomous',
      MINECRAFT_USERNAME: 'MaraBot'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    startEngineProxyImpl: () => {
      counter.starts += 1
      return createEngineProxyStub({ starts: 0, exitWrites: 0, shutdownCalls: 0, lines: [] })
    },
    attachStdin: false,
    logFn: () => {},
    chatMinIntervalMs: 0
  })

  runtime.startFromEnv()
  runtime.shutdown('auto')

  assert.equal(counter.starts, 0)
})

test('shutdown is safe when proxy engine process is already dead', { timeout: 2000 }, () => {
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: 'fake-engine.js',
      BOT_NAMES: 'mara'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    startEngineProxyImpl: () => ({
      process: { killed: true },
      sendLine() {
        return false
      },
      sendExit() {
        return false
      },
      shutdown() {},
      isExitSent() {
        return true
      }
    }),
    attachStdin: false,
    logFn: () => {}
  })

  runtime.startFromEnv()
  assert.doesNotThrow(() => runtime.shutdown('already-dead'))
})
