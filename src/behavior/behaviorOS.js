const { appendReflection } = require('../memory/botMemoryStore')
const { chooseTask, TASK_IDS } = require('./planner')
const { evaluateTaskLegality } = require('./laws')
const { TASK_MODULES } = require('./tasks')
const { boundedScan, randomInt, withActionTimeout } = require('./tasks/taskUtils')

function parseOptionalPoint(prefix) {
  const x = Number(process.env[`${prefix}_X`])
  const y = Number(process.env[`${prefix}_Y`])
  const z = Number(process.env[`${prefix}_Z`])
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z }
  }
  return null
}

class BehaviorOS {
  constructor({ bot, mind, worldAuthority, runtime, config = {} }) {
    this.bot = bot
    this.mind = mind
    this.worldAuthority = worldAuthority
    this.runtime = runtime
    this.taskModules = config.taskModules || TASK_MODULES
    this.chooseTaskFn = config.chooseTaskFn || chooseTask
    this.boundedScanFn = config.boundedScanFn || boundedScan
    this.withActionTimeoutFn = config.withActionTimeoutFn || withActionTimeout
    this.evaluateTaskLegalityFn = config.evaluateTaskLegalityFn || evaluateTaskLegality
    this.appendReflectionFn = config.appendReflectionFn || appendReflection
    this.randomIntFn = config.randomIntFn || randomInt
    this.nowFn = config.nowFn || Date.now
    this.setTimeoutFn = config.setTimeoutFn || setTimeout
    this.clearTimeoutFn = config.clearTimeoutFn || clearTimeout
    const envAllowCombat = process.env.ALLOW_COMBAT || ''
    const envAllowDig = process.env.ALLOW_DIG || ''
    const envAllowBlockBreaking = process.env.ALLOW_BLOCK_BREAKING || envAllowDig
    const envAllowChestTake = process.env.ALLOW_CHEST_TAKE || ''
    const envAllowTrading = process.env.ALLOW_TRADING || ''
    const allowTradingRaw = config.allowTrading ?? (envAllowTrading || 'true')
    const actionCapRaw = config.actionsPerTickCap ?? process.env.ACTIONS_PER_TICK_CAP
    const parsedActionCap = Number(actionCapRaw)

    this.config = {
      loopMinMs: Number(config.loopMinMs) || Number(process.env.BEHAVIOR_LOOP_MIN_MS) || 2000,
      loopMaxMs: Number(config.loopMaxMs) || Number(process.env.BEHAVIOR_LOOP_MAX_MS) || 5000,
      actionTimeoutMs: Number(config.actionTimeoutMs) || Number(process.env.ACTION_TIMEOUT_MS) || 12000,
      allowCombat: String(config.allowCombat ?? envAllowCombat).toLowerCase() === 'true',
      allowBlockBreaking: String(config.allowBlockBreaking ?? envAllowBlockBreaking).toLowerCase() === 'true',
      allowChestTake: String(config.allowChestTake ?? envAllowChestTake).toLowerCase() === 'true',
      allowTrading: String(allowTradingRaw).toLowerCase() !== 'false',
      actionsPerTickCap: Number.isFinite(parsedActionCap)
        ? Math.max(0, parsedActionCap)
        : 1,
      autoReschedule: config.autoReschedule !== false,
      scanEntityRadius: Number(config.scanEntityRadius) || 24,
      scanBlockRadius: Number(config.scanBlockRadius) || 18
    }

    this.poi = {
      church: parseOptionalPoint('CHURCH'),
      shelter: parseOptionalPoint('SHELTER')
    }

    this.running = false
    this.executing = false
    this.loopTimer = null
    this.currentActionAbort = null
    this.currentTaskId = null
    this.lastTickMs = this.nowFn()
  }

  start() {
    if (this.running) {
      return
    }
    this.running = true
    this.scheduleNextTick(800)
  }

  stop(reason = 'stop') {
    this.running = false
    if (this.loopTimer) {
      this.clearTimeoutFn(this.loopTimer)
      this.loopTimer = null
    }
    if (this.currentActionAbort) {
      this.currentActionAbort.abort()
      this.currentActionAbort = null
    }
    this.runtime.log(`[BehaviorOS:${this.bot.username}] halted (${reason})`)
  }

  stopActiveTask() {
    if (!this.currentActionAbort) {
      return false
    }
    this.currentActionAbort.abort()
    return true
  }

  scheduleNextTick(delayMs) {
    if (!this.running) {
      return
    }
    const delay = Number.isFinite(Number(delayMs))
      ? Number(delayMs)
      : this.randomIntFn(this.config.loopMinMs, this.config.loopMaxMs)
    this.loopTimer = this.setTimeoutFn(() => this.tick(), Math.max(200, delay))
  }

  async tick() {
    if (!this.running) {
      return
    }

    if (this.executing) {
      this.scheduleNextTick(this.config.loopMinMs)
      return
    }

    this.executing = true
    const tickStartedAt = this.nowFn()
    const elapsed = tickStartedAt - this.lastTickMs
    this.lastTickMs = tickStartedAt
    let actionsExecuted = 0

    let selectedTask = 'idle'
    let outcome = null
    let plan = null

    try {
      const authoritySnapshot = this.worldAuthority.refresh(this.bot)
      const perception = this.boundedScanFn(this.bot, authoritySnapshot, {
        entityRadius: this.config.scanEntityRadius,
        blockRadius: this.config.scanBlockRadius,
        maxEntities: 24,
        blockCount: 16
      })

      this.mind.updateNeeds({
        perception,
        authoritySnapshot,
        elapsedMs: elapsed
      })

      const roles = this.mind.getRoles()
      const economyStatus = this.worldAuthority.getEconomyStatus()
      const availableTasks = TASK_IDS
        .filter((taskId) => !!this.taskModules[taskId])
        .filter((taskId) => {
          if (!this.config.allowCombat && taskId === 'raidDefense') {
            return false
          }
          if (!this.config.allowBlockBreaking && (taskId === 'chopWood' || taskId === 'mineOre')) {
            return false
          }
          if (!this.config.allowTrading && (taskId === 'workTrade' || taskId === 'escortCaravan' || taskId === 'diplomacy')) {
            return false
          }
          return true
        })

      if (this.mind.mode === 'manual') {
        selectedTask = 'healRest'
      } else {
        plan = this.chooseTaskFn({
          needs: this.mind.needs,
          roles,
          authoritySnapshot,
          economyStatus,
          perception,
          availableTasks
        })
        selectedTask = plan.taskId
      }

      if (selectedTask === 'idle') {
        outcome = {
          ok: true,
          note: 'No high-utility task selected. Maintaining low activity.',
          needDelta: {
            social: 1
          },
          cooldownMs: this.randomIntFn(this.config.loopMinMs, this.config.loopMaxMs)
        }
      } else {
        const policy = {
          allowCombat: this.config.allowCombat,
          allowBlockBreaking: this.config.allowBlockBreaking,
          allowChestTake: this.config.allowChestTake,
          allowTrading: this.config.allowTrading
        }

        const legality = this.evaluateTaskLegalityFn(selectedTask, {
          lawState: authoritySnapshot.lawState,
          role: roles.primary,
          isNight: authoritySnapshot.isNight,
          famineSeverity: authoritySnapshot.events.famineSeverity,
          allowBlockBreaking: policy.allowBlockBreaking,
          allowCombat: policy.allowCombat,
          allowChestTake: policy.allowChestTake,
          allowTrading: policy.allowTrading
        })

        if (!legality.allowed) {
          outcome = {
            ok: false,
            illegal: true,
            lawName: legality.lawName,
            note: legality.reason,
            cooldownMs: 2200
          }
          this.runtime.log(
            `[BehaviorOS:${this.bot.username}] blocked task=${selectedTask} law=${legality.lawName} reason=${legality.reason}`
          )
        } else if (!this.mind.canRunTask(selectedTask)) {
          outcome = {
            ok: false,
            note: `Task ${selectedTask} on cooldown.`,
            cooldownMs: Math.min(3000, this.mind.getCooldownRemainingMs(selectedTask))
          }
        } else if (actionsExecuted >= this.config.actionsPerTickCap) {
          outcome = {
            ok: false,
            note: `Per-tick action cap ${this.config.actionsPerTickCap} reached.`,
            cooldownMs: 1000
          }
        } else {
          const task = this.taskModules[selectedTask]
          if (!task) {
            outcome = {
              ok: false,
              note: `Task module '${selectedTask}' is missing.`,
              cooldownMs: 1000
            }
          } else {
            actionsExecuted += 1
            const actionController = new AbortController()
            this.currentActionAbort = actionController
            this.currentTaskId = selectedTask

            try {
              outcome = await this.withActionTimeoutFn(
                this.config.actionTimeoutMs,
                actionController.signal,
                async (signal) => task.run({
                  bot: this.bot,
                  mind: this.mind,
                  worldAuthority: this.worldAuthority,
                  runtime: this.runtime,
                  authoritySnapshot,
                  economyStatus,
                  perception,
                  policy,
                  signal,
                  poi: this.poi
                })
              )
            } catch (error) {
              if (error?.name === 'AbortError') {
                outcome = {
                  ok: false,
                  note: 'Task aborted.',
                  cooldownMs: 1000
                }
              } else {
                outcome = {
                  ok: false,
                  note: `Task exception: ${error?.message || String(error)}`,
                  cooldownMs: 2200
                }
              }
            } finally {
              this.currentActionAbort = null
              this.currentTaskId = null
            }
          }
        }
      }

      if (outcome?.goods) {
        this.worldAuthority.depositGoods(outcome.goods, this.bot.username, selectedTask)
      }

      if (outcome?.trade) {
        this.worldAuthority.recordTrade(outcome.trade)
      }

      if (outcome?.needDelta) {
        this.mind.applyTaskOutcome(outcome)
      }

      this.mind.recordTaskResult(selectedTask, !!outcome?.ok)
      if (Number(outcome?.cooldownMs) > 0) {
        this.mind.setTaskCooldown(selectedTask, Number(outcome.cooldownMs))
      }

      this.appendReflectionFn(this.bot.username, {
        taskId: selectedTask,
        score: plan?.score ?? null,
        mode: this.mind.mode,
        roles: this.mind.getRoles(),
        mood: this.mind.mood,
        needs: this.mind.needs,
        outcome: {
          ok: !!outcome?.ok,
          illegal: !!outcome?.illegal,
          lawName: outcome?.lawName || null,
          note: outcome?.note || ''
        }
      })
    } catch (error) {
      this.runtime.log(
        `[BehaviorOS:${this.bot.username}] loop failure: ${error?.stack || error?.message || String(error)}`
      )
      this.appendReflectionFn(this.bot.username, {
        taskId: selectedTask,
        score: plan?.score ?? null,
        mode: this.mind.mode,
        outcome: {
          ok: false,
          note: `loop error: ${error?.message || String(error)}`
        }
      })
      outcome = {
        ok: false,
        note: 'loop error',
        cooldownMs: 2000
      }
    } finally {
      this.executing = false
      if (this.running && this.config.autoReschedule) {
        this.scheduleNextTick(
          outcome?.cooldownMs || this.randomIntFn(this.config.loopMinMs, this.config.loopMaxMs)
        )
      }
    }
  }
}

module.exports = {
  BehaviorOS
}
