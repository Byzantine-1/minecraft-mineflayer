const {
  attackNearestHostileMob,
  sleep
} = require('./taskUtils')

module.exports = {
  id: 'raidDefense',
  description: 'Raid response against hostile mobs only (never players).',
  async run(context) {
    const signal = context.signal
    const hostiles = context.perception?.nearbyHostiles || []
    const allowCombat = !!context.policy?.allowCombat

    if (!allowCombat) {
      await sleep(500, signal)
      return {
        ok: false,
        note: 'Combat disabled; switched to passive defense posture.',
        needDelta: {
          safety: 2,
          purpose: 3
        },
        cooldownMs: 3000
      }
    }

    const attackResult = await attackNearestHostileMob(context.bot, hostiles, {
      allowCombat,
      signal
    })

    if (!attackResult.ok) {
      return {
        ok: false,
        note: attackResult.note || 'No valid raid defense target.',
        cooldownMs: 2800
      }
    }

    return {
      ok: true,
      note: attackResult.note,
      needDelta: {
        safety: 10,
        purpose: 11,
        fatigue: -5
      },
      cooldownMs: 5200
    }
  }
}

