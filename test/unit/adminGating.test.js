const test = require('node:test')
const assert = require('node:assert/strict')

const { IntentRouter } = require('../../src/intents/intentRouter')

function makeRuntimeHarness() {
  return {
    chats: [],
    logs: [],
    bots: new Map([['mara', {}]]),
    sendChat(botName, message) {
      this.chats.push({ botName, message: String(message) })
      return true
    },
    broadcast(message) {
      this.chats.push({ botName: 'broadcast', message: String(message) })
    },
    log(message) {
      this.logs.push(String(message))
    },
    getDefaultBotName() {
      return 'mara'
    },
    setBotMode() {
      return { ok: true, mode: 'auto' }
    },
    setBotRole() {
      return { ok: true }
    },
    stopActiveTask() {
      return false
    },
    appointCitizen() {
      return { ok: true, name: 'x', role: 'farmer', spawned: false }
    }
  }
}

function makeWorldAuthorityHarness() {
  return {
    recordViolation() {
      return -1
    },
    getSettlementStatus() {
      return {
        events: {
          famineSeverity: 0,
          longNight: false,
          raidSeverity: 0,
          war: { factionA: null, factionB: null, intensity: 0 }
        },
        population: {
          simulatedPopulation: 1,
          households: 1,
          morale: 50,
          births: 0,
          deaths: 0,
          migrationNet: 0
        },
        reputation: {}
      }
    },
    getEconomyStatus() {
      return {
        councilBudget: 0,
        taxRate: 0,
        storage: 'none',
        contracts: []
      }
    },
    listLaws() {
      return []
    },
    setLaw() {
      return { ok: true, law: 'curfew', enabled: true }
    },
    addCouncilDecree() {
      return null
    },
    setFamine() {
      return 0
    },
    setLongNight() {
      return false
    },
    setWar() {
      return { factionA: null, factionB: null, intensity: 0 }
    }
  }
}

test('non-admin cannot issue expedition permits', { timeout: 2000 }, async () => {
  const runtime = makeRuntimeHarness()
  const router = new IntentRouter({
    runtime,
    worldAuthority: makeWorldAuthorityHarness(),
    adminUsers: 'IntentJester8'
  })

  await router.handleChat({
    botName: 'mara',
    username: 'RandomUser',
    message: '!all council permit expedition test run'
  })

  assert.ok(runtime.chats.some((entry) => entry.message.includes('Refusing request due to law')))
  assert.ok(runtime.chats.some((entry) => entry.message.includes('Violation report')))
})
