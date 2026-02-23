const { getPosition, safeMoveTo, sleep } = require('./taskUtils')

function shelterPointFromContext(context) {
  const explicit = context.poi?.shelter
  if (
    explicit &&
    Number.isFinite(Number(explicit.x)) &&
    Number.isFinite(Number(explicit.y)) &&
    Number.isFinite(Number(explicit.z))
  ) {
    return {
      x: Number(explicit.x),
      y: Number(explicit.y),
      z: Number(explicit.z)
    }
  }
  return getPosition(context.bot)
}

module.exports = {
  id: 'fleeShelter',
  description: 'Immediate safety action during high danger periods.',
  async run(context) {
    const signal = context.signal
    const shelterPoint = shelterPointFromContext(context)

    if (shelterPoint) {
      await safeMoveTo(context.bot, shelterPoint, {
        range: 2,
        timeoutMs: 7000,
        signal
      })
    }
    await sleep(600, signal)

    return {
      ok: true,
      note: 'Reached shelter and paused for safety.',
      needDelta: {
        safety: 13,
        fatigue: 5,
        purpose: -2
      },
      cooldownMs: 2200
    }
  }
}

