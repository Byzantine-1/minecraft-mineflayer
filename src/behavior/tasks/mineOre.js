const { randomInt, safeMoveTo, sleep } = require('./taskUtils')

module.exports = {
  id: 'mineOre',
  description: 'Collect ore under explicit block-breaking authorization.',
  async run(context) {
    if (!context.policy?.allowBlockBreaking) {
      return {
        ok: false,
        illegal: true,
        lawName: 'no_breaking_blocks',
        note: 'No explicit authorization to break blocks.',
        cooldownMs: 5000
      }
    }

    const signal = context.signal
    const target = context.perception?.candidateBlocks?.ores?.[0]
    if (target) {
      await safeMoveTo(context.bot, target, {
        range: 2,
        timeoutMs: 9500,
        signal
      })
    } else {
      await sleep(800, signal)
    }

    return {
      ok: true,
      note: 'Collected ore for virtual settlement storage.',
      goods: { ore_stock: randomInt(1, 2) },
      needDelta: {
        purpose: 9,
        fatigue: -6
      },
      cooldownMs: 6500
    }
  }
}

