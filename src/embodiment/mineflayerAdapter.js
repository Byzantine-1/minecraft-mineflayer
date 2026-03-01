const { goals } = require('mineflayer-pathfinder')

const {
  EMBODIMENT_REQUEST_TYPE,
  createEmbodimentEvent,
  createEmbodimentResult,
  buildEmbodimentRequest
} = require('./contract')

const GoalFollow = goals?.GoalFollow
const GoalNear = goals?.GoalNear

function toPositionVector(target) {
  if (!target || target.kind !== 'position') {
    return null
  }
  return {
    x: target.x,
    y: target.y,
    z: target.z
  }
}

function toBackendRef(value) {
  return value ? String(value) : undefined
}

function sleepWith(setTimeoutFn, ms) {
  return new Promise((resolve) => {
    setTimeoutFn(resolve, Math.max(0, Number(ms) || 0))
  })
}

class MineflayerEmbodimentAdapter {
  constructor({ runtime, emitEvent = () => {}, nowFn = () => Date.now(), setTimeoutFn = setTimeout } = {}) {
    this.runtime = runtime
    this.emitEventFn = emitEvent
    this.nowFn = nowFn
    this.setTimeoutFn = setTimeoutFn
    this.backend = 'mineflayer'
  }

  emitEvent(event) {
    if (!event) {
      return
    }
    try {
      this.emitEventFn(event)
    } catch (error) {
      this.runtime?.log?.(`[Embodiment] event emission failed: ${error.message}`)
    }
  }

  resolveRecord(actorId) {
    if (!actorId || !this.runtime || typeof this.runtime.resolveBotRecord !== 'function') {
      return null
    }
    return this.runtime.resolveBotRecord(actorId)
  }

  resolveEntity(bot, target) {
    if (!bot || !target || target.kind !== 'entity') {
      return null
    }

    const entries = Object.values(bot.entities || {})
    if (target.entityId) {
      const direct = entries.find(
        (entity) => String(entity?.id ?? entity?.entityId ?? '') === String(target.entityId)
      )
      if (direct) {
        return direct
      }
    }

    if (!target.name) {
      return null
    }

    return entries.find((entity) => {
      const name = String(
        entity?.username ?? entity?.displayName ?? entity?.name ?? ''
      ).toLowerCase()
      return name === target.name
    })
  }

  async applySpeech(request, action) {
    const actorId = action.actorId || request.actorId
    const sent = this.runtime?.sendChat?.(actorId, action.text, action.delivery)
    if (sent) {
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: 'speech delivered',
        backendRef: 'chat'
      }
    }

    return {
      actionId: action.actionId,
      type: action.type,
      status: 'ignored',
      note: 'speech suppressed by runtime controls',
      backendRef: 'chat'
    }
  }

  async applyMovement(bot, action) {
    if (action.mode === 'stop') {
      if (bot.pathfinder && typeof bot.pathfinder.setGoal === 'function') {
        bot.pathfinder.setGoal(null)
      }
      if (typeof bot.clearControlStates === 'function') {
        bot.clearControlStates()
      }
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: 'movement stopped',
        backendRef: 'movement.stop'
      }
    }

    if (action.target?.kind === 'position') {
      const position = toPositionVector(action.target)
      if (action.mode === 'face' && typeof bot.lookAt === 'function') {
        await bot.lookAt(position)
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'applied',
          note: 'facing position target',
          backendRef: 'lookAt'
        }
      }

      if (
        action.mode === 'approach' &&
        bot.pathfinder &&
        typeof bot.pathfinder.setGoal === 'function' &&
        GoalNear
      ) {
        bot.pathfinder.setGoal(
          new GoalNear(position.x, position.y, position.z, action.target.radius ?? 1),
          false
        )
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'applied',
          note: 'movement goal queued',
          backendRef: 'pathfinder.goal_near'
        }
      }
    }

    if (action.target?.kind === 'entity') {
      const entity = this.resolveEntity(bot, action.target)
      if (!entity) {
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'failed',
          note: 'entity target unavailable',
          backendRef: 'entity.lookup'
        }
      }

      if (action.mode === 'face' && entity.position && typeof bot.lookAt === 'function') {
        await bot.lookAt(entity.position)
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'applied',
          note: 'facing entity target',
          backendRef: 'lookAt'
        }
      }

      if (
        (action.mode === 'follow' || action.mode === 'approach') &&
        bot.pathfinder &&
        typeof bot.pathfinder.setGoal === 'function' &&
        GoalFollow
      ) {
        bot.pathfinder.setGoal(new GoalFollow(entity, action.target.radius ?? 1), true)
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'applied',
          note: 'follow goal queued',
          backendRef: 'pathfinder.goal_follow'
        }
      }
    }

    return {
      actionId: action.actionId,
      type: action.type,
      status: 'failed',
      note: 'movement intent unsupported by bot capabilities',
      backendRef: 'movement.unsupported'
    }
  }

  async applyInteraction(bot, action) {
    if (action.interaction === 'swing_arm' && typeof bot.swingArm === 'function') {
      await bot.swingArm(action.hand)
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: 'arm swing executed',
        backendRef: 'swingArm'
      }
    }

    if (action.interaction === 'activate_item' && typeof bot.activateItem === 'function') {
      await bot.activateItem()
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: 'held item activated',
        backendRef: 'activateItem'
      }
    }

    if (action.interaction === 'use_entity' && typeof bot.activateEntity === 'function') {
      const entity = this.resolveEntity(bot, action.target)
      if (!entity) {
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'failed',
          note: 'entity target unavailable',
          backendRef: 'entity.lookup'
        }
      }
      await bot.activateEntity(entity)
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: 'entity interaction dispatched',
        backendRef: toBackendRef(entity.id ?? entity.entityId ?? 'entity')
      }
    }

    if (
      action.interaction === 'use_block' &&
      action.target?.kind === 'position' &&
      typeof bot.blockAt === 'function' &&
      typeof bot.activateBlock === 'function'
    ) {
      const block = bot.blockAt(action.target)
      await bot.activateBlock(block)
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: 'block interaction dispatched',
        backendRef: 'activateBlock'
      }
    }

    return {
      actionId: action.actionId,
      type: action.type,
      status: 'failed',
      note: 'interaction intent unsupported by bot capabilities',
      backendRef: 'interaction.unsupported'
    }
  }

  async applyAmbient(bot, action) {
    if (action.gesture === 'wait') {
      await sleepWith(this.setTimeoutFn, action.durationMs)
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: `${action.style} pause completed`,
        backendRef: 'ambient.wait'
      }
    }

    if (action.gesture === 'look') {
      if (action.target && typeof bot.lookAt === 'function') {
        await bot.lookAt(toPositionVector(action.target))
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'applied',
          note: `${action.style} lookAt completed`,
          backendRef: 'lookAt'
        }
      }
      if (action.facing && typeof bot.look === 'function') {
        await bot.look(action.facing.yaw, action.facing.pitch, true)
        return {
          actionId: action.actionId,
          type: action.type,
          status: 'applied',
          note: `${action.style} look completed`,
          backendRef: 'look'
        }
      }
    }

    if (action.gesture === 'swing_arm' && typeof bot.swingArm === 'function') {
      await bot.swingArm('right')
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: `${action.style} arm swing completed`,
        backendRef: 'swingArm'
      }
    }

    if (
      (action.gesture === 'jump' || action.gesture === 'crouch') &&
      typeof bot.setControlState === 'function'
    ) {
      const control = action.gesture === 'jump' ? 'jump' : 'sneak'
      bot.setControlState(control, true)
      await sleepWith(this.setTimeoutFn, action.durationMs)
      bot.setControlState(control, false)
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'applied',
        note: `${action.style} ${action.gesture} completed`,
        backendRef: `control.${control}`
      }
    }

    return {
      actionId: action.actionId,
      type: action.type,
      status: 'failed',
      note: 'ambient action unsupported by bot capabilities',
      backendRef: 'ambient.unsupported'
    }
  }

  async applyAction(request, action) {
    const actorId = action.actorId || request.actorId
    const record = this.resolveRecord(actorId)
    const bot = record?.bot
    if (!bot) {
      return {
        actionId: action.actionId,
        type: action.type,
        status: 'failed',
        note: `bot '${actorId || 'unknown'}' unavailable`,
        backendRef: 'bot.lookup'
      }
    }

    if (action.type === 'speech.say') {
      return this.applySpeech(request, action)
    }
    if (action.type === 'movement.intent') {
      return this.applyMovement(bot, action)
    }
    if (action.type === 'interaction.intent') {
      return this.applyInteraction(bot, action)
    }
    if (action.type === 'ambient.perform') {
      return this.applyAmbient(bot, action)
    }

    return {
      actionId: action.actionId,
      type: action.type,
      status: 'failed',
      note: 'unsupported action type',
      backendRef: 'action.unsupported'
    }
  }

  async applyRequest(request) {
    const startedAt = this.nowFn()
    const safeRequest = request && request.type === EMBODIMENT_REQUEST_TYPE
      ? request
      : null

    if (!safeRequest) {
      const invalidResult = createEmbodimentResult({
        request: {
          sourceType: 'execution-result.v1',
          accepted: false,
          actions: []
        },
        backend: this.backend,
        outcomes: [],
        startedAt,
        finishedAt: this.nowFn(),
        error: new Error('Embodiment request is missing or malformed.')
      })
      this.emitEvent(
        createEmbodimentEvent({
          event: 'request.completed',
          backend: this.backend,
          result: invalidResult,
          ts: this.nowFn()
        })
      )
      return invalidResult
    }

    const outcomes = []

    try {
      if (!safeRequest.accepted) {
        const result = createEmbodimentResult({
          request: safeRequest,
          backend: this.backend,
          outcomes,
          startedAt,
          finishedAt: this.nowFn()
        })
        this.emitEvent(
          createEmbodimentEvent({
            event: 'request.completed',
            backend: this.backend,
            request: safeRequest,
            result,
            ts: this.nowFn()
          })
        )
        return result
      }

      for (const action of safeRequest.actions) {
        const outcome = await this.applyAction(safeRequest, action)
        outcomes.push(outcome)

        this.emitEvent(
          createEmbodimentEvent({
            event: `action.${outcome.status}`,
            backend: this.backend,
            request: safeRequest,
            outcome,
            ts: this.nowFn()
          })
        )
      }

      const result = createEmbodimentResult({
        request: safeRequest,
        backend: this.backend,
        outcomes,
        startedAt,
        finishedAt: this.nowFn()
      })
      this.emitEvent(
        createEmbodimentEvent({
          event: 'request.completed',
          backend: this.backend,
          request: safeRequest,
          result,
          ts: this.nowFn()
        })
      )
      return result
    } catch (error) {
      const result = createEmbodimentResult({
        request: safeRequest,
        backend: this.backend,
        outcomes,
        startedAt,
        finishedAt: this.nowFn(),
        error
      })
      this.emitEvent(
        createEmbodimentEvent({
          event: 'request.completed',
          backend: this.backend,
          request: safeRequest,
          result,
          ts: this.nowFn()
        })
      )
      return result
    }
  }

  async embodyExecutionResult(executionResult) {
    const request = buildEmbodimentRequest(executionResult)
    return this.applyRequest(request)
  }
}

module.exports = {
  MineflayerEmbodimentAdapter
}
