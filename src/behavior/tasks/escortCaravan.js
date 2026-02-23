const { getPosition, safeMoveTo, sleep } = require('./taskUtils')

function rallyPointFromContext(context) {
  const explicit = context.authoritySnapshot?.institutions?.militia?.rallyPoint
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
  id: 'escortCaravan',
  description: 'Escort trade runs with bounded route checks.',
  async run(context) {
    const signal = context.signal
    const rally = rallyPointFromContext(context)

    if (rally) {
      await safeMoveTo(context.bot, rally, {
        range: 4,
        timeoutMs: 9500,
        signal
      })
    }
    await sleep(1100, signal)

    return {
      ok: true,
      note: 'Escorted caravan route segment.',
      needDelta: {
        purpose: 9,
        safety: 4,
        fatigue: -3
      },
      cooldownMs: 6800
    }
  }
}

