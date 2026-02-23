const assert = require('node:assert/strict')

const { BehaviorOS } = require('../src/behavior/behaviorOS')
const { createFakeBot } = require('../test/helpers/fakeBot')
const { waitFor } = require('../test/helpers/waitFor')

function createMind() {
  return {
    mode: 'auto',
    needs: { hunger: 10, fatigue: 60, safety: 70, social: 65, purpose: 50, faith: 50 },
    mood: 'steady',
    updateNeeds() {},
    getRoles() {
      return { primary: 'farmer', secondary: 'trader' }
    },
    canRunTask() {
      return true
    },
    getCooldownRemainingMs() {
      return 0
    },
    applyTaskOutcome() {},
    recordTaskResult() {},
    setTaskCooldown() {}
  }
}

async function main() {
  let ran = 0
  let aborted = false

  const bot = createFakeBot({ username: 'MaraBot', autoSpawn: false })
  const worldAuthority = {
    refresh() {
      return {
        dayStamp: 1,
        daySeed: 123,
        timeOfDay: 'day',
        isNight: false,
        nightDangerIndex: 20,
        events: {
          longNight: false,
          famineSeverity: 0,
          war: { factionA: null, factionB: null, intensity: 0 },
          raidSeverity: 0
        },
        institutions: {
          council: { priorities: { food: 1, defense: 0.6, expansion: 0.4 } }
        },
        lawState: {
          curfew: true,
          no_attack_players: true,
          no_breaking_blocks: true,
          trade_fairness: true,
          rationing: true,
          no_chest_take: true
        },
        serviceActive: false
      }
    },
    getEconomyStatus() {
      return {
        storage: 'food_stock 20/100',
        prices: { food_stock: 10 },
        contracts: [{ id: 'board_food_stock', resource: 'food_stock', target: 100, priority: 1 }]
      }
    },
    depositGoods() {},
    recordTrade() {}
  }

  const runtime = { log() {} }

  const behavior = new BehaviorOS({
    bot,
    mind: createMind(),
    worldAuthority,
    runtime,
    config: {
      loopMinMs: 10,
      loopMaxMs: 10,
      actionTimeoutMs: 200,
      autoReschedule: false,
      taskModules: {
        gatherFood: {
          id: 'gatherFood',
          async run({ signal }) {
            ran += 1
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve({ ok: true, cooldownMs: 1 }), 40)
              signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  aborted = true
                  const error = new Error('Task aborted')
                  error.name = 'AbortError'
                  reject(error)
                },
                { once: true }
              )
            })
          }
        }
      },
      chooseTaskFn: () => ({ taskId: 'gatherFood', score: 100, scoreTable: { gatherFood: 100 } }),
      boundedScanFn: () => ({ taskDistances: { gatherFood: 4 } }),
      withActionTimeoutFn: async (_timeoutMs, signal, action) => action(signal),
      appendReflectionFn: () => {},
      randomIntFn: () => 10
    }
  })

  behavior.running = true
  const tickPromise = behavior.tick()
  await waitFor(() => !!behavior.currentActionAbort, 1500)
  behavior.stopActiveTask()
  await tickPromise

  assert.ok(ran >= 1)
  assert.equal(aborted, true)
  behavior.stop('smoke-auto')
  console.log('PASS smokeAutonomous')
}

main().catch((error) => {
  console.error('FAIL smokeAutonomous')
  console.error(error)
  process.exit(1)
})
