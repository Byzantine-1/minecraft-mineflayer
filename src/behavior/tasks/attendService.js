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
  id: 'attendService',
  description: 'Attend scheduled service to boost social and faith needs.',
  async run(context) {
    const signal = context.signal
    const churchPoint = churchPointFromContext(context)
    if (churchPoint) {
      await safeMoveTo(context.bot, churchPoint, {
        range: 4,
        timeoutMs: 8500,
        signal
      })
    }

    await sleep(1400, signal)
    const serviceActive = !!context.authoritySnapshot?.serviceActive

    return {
      ok: true,
      note: serviceActive ? 'Participated in service.' : 'Visited church for quiet reflection.',
      needDelta: {
        faith: serviceActive ? 14 : 8,
        social: 8,
        purpose: 3
      },
      cooldownMs: 7000
    }
  }
}

