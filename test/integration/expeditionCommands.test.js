const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { waitFor } = require('../helpers/waitFor')
const { loadSettlement, resolveStatePaths } = require('../../src/state/stateStore')

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-expedition-int-'))
}

test('autonomous chat commands drive expedition state transitions', { timeout: 8000 }, async () => {
  const stateDir = makeTempStateDir()
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'autonomous',
      BOT_NAMES: 'mara',
      ADMIN_USERS: 'IntentJester8',
      STATE_DIR: stateDir
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username, autoSpawn: false }),
    attachStdin: false,
    chatMinIntervalMs: 0,
    logFn: () => {}
  })

  try {
    runtime.startFromEnv()
    const maraBot = runtime.resolveBotRecord('mara').bot

    maraBot.emit('chat', 'NotAdmin', '!all council permit expedition no')
    await waitFor(
      () => maraBot.chats.some((line) => line.includes("Refusing request due to law 'governance'")),
      2000
    )

    maraBot.emit('chat', 'IntentJester8', '!all council permit expedition recover relic')
    await waitFor(
      () => !!loadSettlement({ stateDir }).pendingPermit?.permitId,
      2000
    )
    const permitId = loadSettlement({ stateDir }).pendingPermit.permitId

    maraBot.emit('chat', 'IntentJester8', `!all church rite warding ${permitId}`)
    await waitFor(
      () => loadSettlement({ stateDir }).pendingPermit?.blessed === true,
      2000
    )

    maraBot.emit('chat', 'IntentJester8', `!all portal open ${permitId}`)
    await waitFor(
      () => loadSettlement({ stateDir }).portalStatus === 'open',
      2000
    )

    maraBot.emit('chat', 'IntentJester8', `!all expedition start ${permitId} PlayerOne`)
    await waitFor(
      () => loadSettlement({ stateDir }).activeExpedition?.status === 'active',
      2000
    )

    maraBot.emit('chat', 'IntentJester8', '!all expedition fail player_death')
    await waitFor(
      () => loadSettlement({ stateDir }).activeExpedition?.status === 'failed',
      2000
    )

    const settlement = loadSettlement({ stateDir })
    assert.equal(settlement.portalStatus, 'cooldown')
    assert.ok(Number(settlement.cooldownUntilDay) > Number(settlement.currentDay))

    const { logbookFile } = resolveStatePaths(stateDir)
    const logbook = fs.readFileSync(logbookFile, 'utf8')
    assert.match(logbook, /"type":"expedition_failed"/)
    assert.ok(maraBot.chats.some((line) => line.includes('Expedition failed')))
  } finally {
    runtime.shutdown('expedition-integration')
  }
})
