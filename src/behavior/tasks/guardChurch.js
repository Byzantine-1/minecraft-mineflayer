const { getPosition, safeMoveTo, sleep } = require('./taskUtils')

function churchPointFromContext(context) {
  const explicit = context.poi?.church
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
  id: 'guardChurch',
  description: 'Hold a church perimeter position for safety and morale.',
  async run(context) {
    const signal = context.signal
    const churchPoint = churchPointFromContext(context)
    if (churchPoint) {
      await safeMoveTo(context.bot, churchPoint, {
        range: 4,
        timeoutMs: 8000,
        signal
      })
    }
    await sleep(1200, signal)

    return {
      ok: true,
      note: 'Church guard post maintained.',
      needDelta: {
        safety: 6,
        faith: 4,
        purpose: 6
      },
      cooldownMs: 5000
    }
  }
}

