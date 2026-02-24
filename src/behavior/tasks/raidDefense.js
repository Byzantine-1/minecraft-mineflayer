const {
  sleep
} = require('./taskUtils')
const { isMilitiaRole } = require('../../doctrine/militiaDoctrine')

module.exports = {
  id: 'raidDefense',
  description: 'Raid response against hostile mobs only (never players).',
  async run(context) {
    const signal = context.signal
    const allowCombat = !!context.policy?.allowCombat
    const role = context?.mind?.getPrimaryRole
      ? context.mind.getPrimaryRole()
      : context?.mind?.getRoles?.().primary

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

    if (!isMilitiaRole(role)) {
      await sleep(500, signal)
      return {
        ok: false,
        note: 'Combat doctrine restricts raid defense to militia roles.',
        cooldownMs: 3000
      }
    }

    const doctrine = context?.runtime?.militiaDoctrine
    const attackResult = doctrine
      ? await doctrine.engageHostiles({
        bot: context.bot,
        role,
        perception: context.perception,
        allowCombat,
        durationSec: 10,
        radius: Number(context?.authoritySnapshot?.institutions?.militia?.patrolRadius) || 12,
        retreatHp: 8,
        signal
      })
      : {
        ok: false,
        note: 'Militia doctrine unavailable.'
      }

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
