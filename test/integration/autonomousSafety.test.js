const test = require('node:test')
const assert = require('node:assert/strict')

const { chooseTask } = require('../../src/behavior/planner')
const { BehaviorOS } = require('../../src/behavior/behaviorOS')
const { BridgeRuntime } = require('../../src/bridgeRuntime')
const { createFakeBot } = require('../helpers/fakeBot')
const { waitFor } = require('../helpers/waitFor')

function makeMind({ needs, roles, mode = 'auto' }) {
  return {
    mode,
    needs: { ...needs },
    mood: 'steady',
    recordedTasks: [],
    cooldowns: {},
    updateNeeds() {},
    getRoles() {
      return { ...roles }
    },
    canRunTask(taskId) {
      return !this.cooldowns[taskId]
    },
    getCooldownRemainingMs() {
      return 0
    },
    applyTaskOutcome() {},
    recordTaskResult(taskId, ok) {
      this.recordedTasks.push({ taskId, ok })
    },
    setTaskCooldown(taskId) {
      this.cooldowns[taskId] = 1
    }
  }
}

function makeAuthoritySnapshot(overrides = {}) {
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
      council: {
        priorities: {
          food: 1,
          defense: 0.6,
          expansion: 0.4
        }
      },
      militia: {
        patrolRadius: 24
      }
    },
    lawState: {
      curfew: true,
      no_attack_players: true,
      no_breaking_blocks: true,
      trade_fairness: true,
      rationing: true,
      no_chest_take: true
    },
    serviceActive: false,
    ...overrides
  }
}

function makeWorldAuthority(snapshot) {
  return {
    depositCalls: [],
    tradeCalls: [],
    refresh() {
      return snapshot
    },
    getEconomyStatus() {
      return {
        storage: 'food_stock 20/100, wood_stock 30/80, ore_stock 10/60',
        prices: {
          food_stock: 10,
          wood_stock: 8,
          ore_stock: 15
        },
        contracts: [
          { id: 'board_food_stock', resource: 'food_stock', target: 100, priority: 1 }
        ]
      }
    },
    depositGoods(goods) {
      this.depositCalls.push(goods)
    },
    recordTrade(trade) {
      this.tradeCalls.push(trade)
    }
  }
}

function createBehaviorHarness({
  needs,
  roles,
  snapshotOverrides = {},
  taskModules,
  chooseTaskFn = chooseTask,
  config = {}
}) {
  const bot = createFakeBot({ username: 'mara', autoSpawn: false })
  const runtime = {
    logs: [],
    log(message) {
      this.logs.push(message)
    }
  }
  const mind = makeMind({ needs, roles })
  const authoritySnapshot = makeAuthoritySnapshot(snapshotOverrides)
  const worldAuthority = makeWorldAuthority(authoritySnapshot)

  const behavior = new BehaviorOS({
    bot,
    mind,
    worldAuthority,
    runtime,
    config: {
      loopMinMs: 10,
      loopMaxMs: 10,
      actionTimeoutMs: 100,
      autoReschedule: false,
      taskModules,
      chooseTaskFn,
      boundedScanFn: () => ({
        taskDistances: {
          gatherFood: 4,
          healRest: 5,
          fleeShelter: 5,
          patrol: 8,
          raidDefense: 8,
          workTrade: 4
        }
      }),
      withActionTimeoutFn: async (_timeoutMs, signal, action) => action(signal),
      appendReflectionFn: () => {},
      randomIntFn: () => 10,
      ...config
    }
  })

  behavior.running = true
  return { behavior, mind, bot, worldAuthority, runtime, authoritySnapshot }
}

test('autonomous chooses gatherFood when hunger is low', { timeout: 3000 }, async () => {
  let selected = null
  const taskModules = {
    gatherFood: { id: 'gatherFood', run: async () => ({ ok: true, cooldownMs: 1 }) },
    healRest: { id: 'healRest', run: async () => ({ ok: true, cooldownMs: 1 }) },
    workTrade: { id: 'workTrade', run: async () => ({ ok: true, cooldownMs: 1 }) }
  }
  const chooseTaskFn = (input) => {
    const result = chooseTask(input)
    selected = result.taskId
    return result
  }

  const { behavior } = createBehaviorHarness({
    needs: { hunger: 12, fatigue: 70, safety: 70, social: 65, purpose: 50, faith: 55 },
    roles: { primary: 'farmer', secondary: 'trader' },
    taskModules,
    chooseTaskFn
  })

  await behavior.tick()
  assert.equal(selected, 'gatherFood')
})

test('autonomous chooses fleeShelter when safety is critical', { timeout: 3000 }, async () => {
  let selected = null
  const taskModules = {
    gatherFood: { id: 'gatherFood', run: async () => ({ ok: true, cooldownMs: 1 }) },
    fleeShelter: { id: 'fleeShelter', run: async () => ({ ok: true, cooldownMs: 1 }) },
    healRest: { id: 'healRest', run: async () => ({ ok: true, cooldownMs: 1 }) }
  }
  const chooseTaskFn = (input) => {
    const result = chooseTask(input)
    selected = result.taskId
    return result
  }

  const { behavior } = createBehaviorHarness({
    needs: { hunger: 65, fatigue: 55, safety: 10, social: 60, purpose: 60, faith: 55 },
    roles: { primary: 'farmer', secondary: 'trader' },
    taskModules,
    chooseTaskFn
  })

  await behavior.tick()
  assert.equal(selected, 'fleeShelter')
})

test('long night pressure drives militia to patrol or defense tasks', { timeout: 3000 }, async () => {
  let selected = null
  const taskModules = {
    patrol: { id: 'patrol', run: async () => ({ ok: true, cooldownMs: 1 }) },
    raidDefense: { id: 'raidDefense', run: async () => ({ ok: true, cooldownMs: 1 }) },
    healRest: { id: 'healRest', run: async () => ({ ok: true, cooldownMs: 1 }) }
  }
  const chooseTaskFn = (input) => {
    const result = chooseTask(input)
    selected = result.taskId
    return result
  }

  const { behavior } = createBehaviorHarness({
    needs: { hunger: 60, fatigue: 55, safety: 28, social: 55, purpose: 45, faith: 45 },
    roles: { primary: 'guard', secondary: 'trader' },
    snapshotOverrides: {
      isNight: true,
      nightDangerIndex: 88,
      events: {
        longNight: true,
        famineSeverity: 20,
        war: { factionA: 'A', factionB: 'B', intensity: 70 },
        raidSeverity: 80
      }
    },
    taskModules,
    chooseTaskFn,
    config: {
      allowCombat: true
    }
  })

  await behavior.tick()
  assert.ok(selected === 'patrol' || selected === 'raidDefense')
})

test('famine pushes selection toward gatherFood over trading', { timeout: 3000 }, async () => {
  let selected = null
  const taskModules = {
    gatherFood: { id: 'gatherFood', run: async () => ({ ok: true, cooldownMs: 1 }) },
    workTrade: { id: 'workTrade', run: async () => ({ ok: true, cooldownMs: 1 }) }
  }
  const chooseTaskFn = (input) => {
    const result = chooseTask(input)
    selected = result.taskId
    return result
  }

  const { behavior } = createBehaviorHarness({
    needs: { hunger: 45, fatigue: 60, safety: 62, social: 60, purpose: 25, faith: 40 },
    roles: { primary: 'trader', secondary: 'farmer' },
    snapshotOverrides: {
      events: {
        longNight: false,
        famineSeverity: 95,
        war: { factionA: null, factionB: null, intensity: 0 },
        raidSeverity: 0
      }
    },
    taskModules,
    chooseTaskFn
  })

  await behavior.tick()
  assert.equal(selected, 'gatherFood')
})

test('trader role prioritizes workTrade in normal conditions', { timeout: 3000 }, async () => {
  let selected = null
  const taskModules = {
    gatherFood: { id: 'gatherFood', run: async () => ({ ok: true, cooldownMs: 1 }) },
    workTrade: { id: 'workTrade', run: async () => ({ ok: true, cooldownMs: 1 }) }
  }
  const chooseTaskFn = (input) => {
    const result = chooseTask(input)
    selected = result.taskId
    return result
  }

  const { behavior } = createBehaviorHarness({
    needs: { hunger: 72, fatigue: 68, safety: 70, social: 64, purpose: 20, faith: 45 },
    roles: { primary: 'trader', secondary: 'farmer' },
    taskModules,
    chooseTaskFn
  })

  await behavior.tick()
  assert.equal(selected, 'workTrade')
})

test('disallowed toggles prevent task execution (dig/combat/trading)', { timeout: 4000 }, async () => {
  let calledMine = 0
  let calledRaid = 0
  let calledTrade = 0

  const chooseMine = () => ({ taskId: 'mineOre', score: 100, scoreTable: { mineOre: 100 } })
  const { behavior: digBehavior } = createBehaviorHarness({
    needs: { hunger: 50, fatigue: 50, safety: 50, social: 50, purpose: 20, faith: 50 },
    roles: { primary: 'miner', secondary: 'trader' },
    taskModules: {
      mineOre: { id: 'mineOre', run: async () => { calledMine += 1; return { ok: true } } }
    },
    chooseTaskFn: chooseMine,
    config: {
      allowBlockBreaking: false
    }
  })
  await digBehavior.tick()

  const chooseRaid = () => ({ taskId: 'raidDefense', score: 100, scoreTable: { raidDefense: 100 } })
  const { behavior: combatBehavior } = createBehaviorHarness({
    needs: { hunger: 50, fatigue: 50, safety: 30, social: 50, purpose: 50, faith: 40 },
    roles: { primary: 'guard', secondary: 'trader' },
    taskModules: {
      raidDefense: { id: 'raidDefense', run: async () => { calledRaid += 1; return { ok: true } } }
    },
    chooseTaskFn: chooseRaid,
    config: {
      allowCombat: false
    }
  })
  await combatBehavior.tick()

  const chooseTrade = () => ({ taskId: 'workTrade', score: 100, scoreTable: { workTrade: 100 } })
  const { behavior: tradeBehavior } = createBehaviorHarness({
    needs: { hunger: 50, fatigue: 50, safety: 60, social: 50, purpose: 10, faith: 50 },
    roles: { primary: 'trader', secondary: 'farmer' },
    taskModules: {
      workTrade: { id: 'workTrade', run: async () => { calledTrade += 1; return { ok: true } } }
    },
    chooseTaskFn: chooseTrade,
    config: {
      allowTrading: false
    }
  })
  await tradeBehavior.tick()

  assert.equal(calledMine, 0)
  assert.equal(calledRaid, 0)
  assert.equal(calledTrade, 0)
})

test('per-tick action cap prevents execution when cap is zero', { timeout: 2000 }, async () => {
  let called = 0
  const { behavior } = createBehaviorHarness({
    needs: { hunger: 10, fatigue: 60, safety: 70, social: 65, purpose: 55, faith: 50 },
    roles: { primary: 'farmer', secondary: 'trader' },
    taskModules: {
      gatherFood: { id: 'gatherFood', run: async () => { called += 1; return { ok: true } } }
    },
    chooseTaskFn: () => ({ taskId: 'gatherFood', score: 100, scoreTable: { gatherFood: 100 } }),
    config: {
      actionsPerTickCap: 0
    }
  })

  await behavior.tick()
  assert.equal(called, 0)
})

test('BridgeRuntime chat rate limiter suppresses rapid chat spam', { timeout: 3000 }, () => {
  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'autonomous',
      MINECRAFT_USERNAME: 'MaraBot'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    attachStdin: false,
    chatMinIntervalMs: 1000,
    logFn: () => {}
  })

  runtime.startFromEnv()
  const bot = runtime.resolveBotRecord('MaraBot').bot

  const first = runtime.sendChat('MaraBot', 'first')
  const second = runtime.sendChat('MaraBot', 'second')

  assert.equal(first, true)
  assert.equal(second, false)
  assert.equal(bot.chats.length, 1)
  runtime.shutdown('rate-limit')
})

test('task canceled by STOP intent aborts active action', { timeout: 4000 }, async () => {
  let aborted = false

  const { behavior } = createBehaviorHarness({
    needs: { hunger: 10, fatigue: 60, safety: 70, social: 65, purpose: 55, faith: 50 },
    roles: { primary: 'farmer', secondary: 'trader' },
    taskModules: {
      gatherFood: {
        id: 'gatherFood',
        run: async ({ signal }) =>
          new Promise((resolve, reject) => {
            const onAbort = () => {
              aborted = true
              const error = new Error('Task aborted')
              error.name = 'AbortError'
              reject(error)
            }
            signal.addEventListener('abort', onAbort, { once: true })
          })
      }
    },
    chooseTaskFn: () => ({ taskId: 'gatherFood', score: 100, scoreTable: { gatherFood: 100 } })
  })

  const tickPromise = behavior.tick()
  await waitFor(() => !!behavior.currentActionAbort, 1200)
  assert.equal(behavior.stopActiveTask(), true)
  await tickPromise
  assert.equal(aborted, true)
})

test('hung task is bounded by timeout wrapper and does not deadlock loop', { timeout: 3000 }, async () => {
  const { behavior } = createBehaviorHarness({
    needs: { hunger: 10, fatigue: 60, safety: 70, social: 65, purpose: 55, faith: 50 },
    roles: { primary: 'farmer', secondary: 'trader' },
    taskModules: {
      gatherFood: {
        id: 'gatherFood',
        run: async () => new Promise(() => {})
      }
    },
    chooseTaskFn: () => ({ taskId: 'gatherFood', score: 100, scoreTable: { gatherFood: 100 } }),
    config: {
      withActionTimeoutFn: async () => ({
        ok: false,
        note: 'timed out',
        cooldownMs: 1
      })
    }
  })

  await behavior.tick()
  assert.equal(behavior.executing, false)
})
