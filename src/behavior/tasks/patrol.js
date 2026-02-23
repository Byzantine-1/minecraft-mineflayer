const { distance, getPosition, randomInt, safeMoveTo, sleep } = require('./taskUtils')

function toPoint(value) {
  if (
    value &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y)) &&
    Number.isFinite(Number(value.z))
  ) {
    return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }
  }
  return null
}

function buildPatrolTarget(base, radius) {
  const angle = (Date.now() / 1000) % (Math.PI * 2)
  return {
    x: base.x + Math.cos(angle) * radius,
    y: base.y,
    z: base.z + Math.sin(angle) * radius
  }
}

module.exports = {
  id: 'patrol',
  description: 'Perform bounded militia-style perimeter movement.',
  async run(context) {
    const signal = context.signal
    const position = getPosition(context.bot)
    const rallyPoint = toPoint(context.authoritySnapshot?.institutions?.militia?.rallyPoint)
    const anchor = rallyPoint || position
    if (!anchor) {
      await sleep(500, signal)
      return {
        ok: false,
        note: 'No patrol anchor available.',
        cooldownMs: 2500
      }
    }

    const maxRadius = Number(context.authoritySnapshot?.institutions?.militia?.patrolRadius) || 28
    const radius = Math.min(32, Math.max(8, maxRadius))
    const target = buildPatrolTarget(anchor, radius)

    const distanceCap = 48
    if (distance(position, target) > distanceCap) {
      await sleep(400, signal)
      return {
        ok: false,
        note: 'Skipped patrol point outside bounded distance cap.',
        cooldownMs: 2000
      }
    }

    await safeMoveTo(context.bot, target, {
      range: 3,
      timeoutMs: 10000,
      signal
    })

    return {
      ok: true,
      note: 'Completed perimeter patrol segment.',
      needDelta: {
        safety: 7,
        purpose: 9,
        fatigue: -4
      },
      cooldownMs: randomInt(2500, 5500)
    }
  }
}

