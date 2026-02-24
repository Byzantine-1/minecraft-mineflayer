const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { ExpeditionController } = require('../../src/expeditions/expeditionController')
const { loadSettlement, resolveStatePaths } = require('../../src/state/stateStore')

function makeTempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mmf-expedition-state-'))
}

function readLogEntries(stateDir) {
  const { logbookFile } = resolveStatePaths(stateDir)
  const raw = fs.existsSync(logbookFile) ? fs.readFileSync(logbookFile, 'utf8') : ''
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

test('permit lifecycle supports issue -> bless -> open -> start', { timeout: 2000 }, () => {
  const stateDir = makeTempStateDir()
  const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0)
  const controller = new ExpeditionController({
    stateDir,
    nowFn: () => nowMs
  })

  const issued = controller.issuePermit('recover sacred relic', 'IntentJester8')
  assert.equal(issued.ok, true)
  const permitId = issued.permit.permitId

  const blessed = controller.blessPermit(permitId, 'IntentJester8')
  assert.equal(blessed.ok, true)
  assert.equal(blessed.permit.blessed, true)

  const opened = controller.openPortal(permitId, 'IntentJester8')
  assert.equal(opened.ok, true)
  assert.equal(opened.portalStatus, 'open')

  const started = controller.startExpedition(permitId, 'PlayerOne', ['mara', 'eli', 'nox'])
  assert.equal(started.ok, true)
  assert.equal(started.expedition.status, 'active')
  assert.equal(started.expedition.player, 'PlayerOne')

  const settlement = loadSettlement({ stateDir })
  assert.equal(settlement.portalStatus, 'open')
  assert.equal(settlement.activeExpedition.status, 'active')
})

test('player_death fail applies cooldown and writes expedition_failed log', { timeout: 2000 }, () => {
  const stateDir = makeTempStateDir()
  const nowMs = Date.UTC(2026, 0, 2, 12, 0, 0)
  const runtimeStub = {
    stopCalls: 0,
    retreatCalls: 0,
    broadcasts: [],
    stopAllActiveTasks() {
      this.stopCalls += 1
    },
    militiaDoctrine: {
      retreatToRally: () => {
        runtimeStub.retreatCalls += 1
      }
    },
    broadcast(message) {
      this.broadcasts.push(String(message))
    }
  }
  const controller = new ExpeditionController({
    runtime: runtimeStub,
    stateDir,
    nowFn: () => nowMs,
    cooldownDaysFail: 4
  })

  const issued = controller.issuePermit('test fail path', 'IntentJester8')
  const permitId = issued.permit.permitId
  assert.equal(controller.blessPermit(permitId, 'IntentJester8').ok, true)
  assert.equal(controller.openPortal(permitId, 'IntentJester8').ok, true)
  assert.equal(controller.startExpedition(permitId, 'Runner', ['mara']).ok, true)

  const failed = controller.failExpedition('player_death', 'IntentJester8')
  assert.equal(failed.ok, true)
  assert.equal(failed.expedition.status, 'failed')
  assert.equal(failed.portalStatus, 'cooldown')
  assert.equal(runtimeStub.stopCalls, 1)
  assert.equal(runtimeStub.retreatCalls, 1)

  const settlement = loadSettlement({ stateDir })
  assert.equal(settlement.activeExpedition.status, 'failed')
  assert.equal(settlement.portalStatus, 'cooldown')
  assert.equal(
    settlement.cooldownUntilDay,
    settlement.currentDay + 4
  )

  const logs = readLogEntries(stateDir)
  assert.ok(logs.some((entry) => entry.type === 'expedition_failed'))
  assert.ok(runtimeStub.broadcasts.some((line) => line.includes('Expedition failed')))
})
