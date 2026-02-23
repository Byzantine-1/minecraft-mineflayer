const { randomInt, safeMoveTo, sleep } = require('./taskUtils')

module.exports = {
  id: 'chopWood',
  description: 'Collect wood under explicit block-breaking authorization.',
  async run(context) {
    if (!context.policy?.allowBlockBreaking) {
      return {
        ok: false,
        illegal: true,
        lawName: 'no_breaking_blocks',
        note: 'No explicit authorization to break blocks.',
        cooldownMs: 4500
      }
    }

    const signal = context.signal
    const target = context.perception?.candidateBlocks?.logs?.[0]
    if (target) {
      await safeMoveTo(context.bot, target, {
        range: 2,
        timeoutMs: 9000,
        signal
      })
    } else {
      await sleep(700, signal)
    }

    return {
      ok: true,
      note: 'Collected wood for virtual settlement storage.',
      goods: { wood_stock: randomInt(1, 3) },
      needDelta: {
        purpose: 8,
        fatigue: -4
      },
      cooldownMs: 5500
    }
  }
}

