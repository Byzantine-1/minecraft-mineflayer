const { say, sleep } = require('./taskUtils')

module.exports = {
  id: 'diplomacy',
  description: 'Simulate treaty and war-talk messages without combat.',
  async run(context) {
    const signal = context.signal
    const war = context.authoritySnapshot?.events?.war || {}
    const factionA = war.factionA || 'Local Council'
    const factionB = war.factionB || 'Neighbor Settlement'
    const intensity = Number(war.intensity) || 0

    if (intensity > 0) {
      say(
        context.bot,
        `[Diplomacy] Delegation opened talks between ${factionA} and ${factionB} (intensity ${intensity}).`
      )
    } else {
      say(context.bot, '[Diplomacy] Peace delegation reinforced local treaties.')
    }

    await sleep(700, signal)
    return {
      ok: true,
      note: 'Diplomacy update recorded.',
      needDelta: {
        social: 10,
        purpose: 8,
        faith: 2
      },
      cooldownMs: 7000
    }
  }
}
