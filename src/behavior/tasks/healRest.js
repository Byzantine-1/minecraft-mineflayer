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
  id: 'healRest',
  description: 'Recover fatigue and safety at a shelter point.',
  async run(context) {
    const signal = context.signal
    const shelterPoint = shelterPointFromContext(context)

    if (shelterPoint) {
      await safeMoveTo(context.bot, shelterPoint, {
        range: 3,
        timeoutMs: 9000,
        signal
      })
    }

    await sleep(1800, signal)
    return {
      ok: true,
      note: 'Completed a short rest cycle.',
      needDelta: {
        fatigue: 18,
        safety: 8,
        hunger: -2
      },
      cooldownMs: 4200
    }
  }
}

