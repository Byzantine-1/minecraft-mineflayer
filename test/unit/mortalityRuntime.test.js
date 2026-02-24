const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { loadRoster, saveRoster, resolveStatePaths } = require('../../src/state/stateStore')

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-mortality-state-'))
}

test('death marks roster citizen dead and startup skips dead citizens', { timeout: 4000 }, () => {
  const stateDir = makeTempStateDir()
  saveRoster({
    citizens: {
      mara: { alive: true, role: 'militia', reputation: 50 }
    }
  }, { stateDir })

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'autonomous',
      BOT_NAMES: 'mara',
      STATE_DIR: stateDir
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username, autoSpawn: false }),
    attachStdin: false,
    logFn: () => {}
  })

  runtime.startFromEnv()
  const bot = runtime.resolveBotRecord('mara').bot
  bot.emit('death')

  const rosterAfterDeath = loadRoster({ stateDir })
  assert.equal(rosterAfterDeath.citizens.mara.alive, false)
  assert.ok(bot.quitCalls.some((value) => String(value).includes('death')))

  const capture = { createCalls: 0 }
  const runtimeAfterRestart = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'autonomous',
      BOT_NAMES: 'mara',
      STATE_DIR: stateDir
    },
    createBotImpl: (botConfig) => {
      capture.createCalls += 1
      return createFakeBot({ username: botConfig.username, autoSpawn: false })
    },
    attachStdin: false,
    logFn: () => {}
  })

  runtimeAfterRestart.startFromEnv()
  assert.equal(capture.createCalls, 0)
  assert.equal(runtimeAfterRestart.bots.size, 0)

  const { logbookFile } = resolveStatePaths(stateDir)
  const logbook = fs.readFileSync(logbookFile, 'utf8')
  assert.match(logbook, /"type":"npc_death"/)
})
