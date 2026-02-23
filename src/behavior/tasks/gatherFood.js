const {
  randomInt,
  sleep,
  safeMoveTo,
  maybeEatFromInventory
} = require('./taskUtils')

module.exports = {
  id: 'gatherFood',
  description: 'Acquire or forage food with bounded movement and no griefing.',
  async run(context) {
    const signal = context.signal
    const bot = context.bot
    const perception = context.perception || {}
    const famineSeverity = Number(context.authoritySnapshot?.events?.famineSeverity) || 0

    const ateNow = await maybeEatFromInventory(bot, signal)
    const foodTarget = perception.candidateBlocks?.crops?.[0]
    if (foodTarget) {
      await safeMoveTo(bot, foodTarget, {
        range: 2,
        timeoutMs: 8000,
        signal
      })
    } else {
      await sleep(900, signal)
    }

    const foraged = famineSeverity >= 60 ? randomInt(1, 2) : randomInt(2, 4)
    return {
      ok: true,
      note: ateNow ? 'consumed inventory food and foraged supplies' : 'foraged supplies',
      goods: { food_stock: foraged },
      needDelta: {
        hunger: 15,
        purpose: 5
      },
      cooldownMs: 3500
    }
  }
}
