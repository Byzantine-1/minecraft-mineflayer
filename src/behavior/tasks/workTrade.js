const { randomInt, sleep } = require('./taskUtils')

module.exports = {
  id: 'workTrade',
  description: 'Simulate fair trade and contract fulfillment with tax tracking.',
  async run(context) {
    const signal = context.signal
    const contracts = context.economyStatus?.contracts || []
    const contract = contracts[0] || null
    await sleep(900, signal)

    const fallbackResource = 'food_stock'
    const resource = contract?.resource || fallbackResource
    const qty = randomInt(1, 3)
    const unitPrice = Number(context.economyStatus?.prices?.[resource]) || randomInt(3, 8)
    const grossProfit = Number((qty * unitPrice * 0.6).toFixed(2))

    return {
      ok: true,
      note: contract
        ? `Fulfilled board contract ${contract.id} (${qty} ${resource}).`
        : `Executed routine market run (${qty} ${resource}).`,
      goods: {
        [resource]: qty
      },
      trade: {
        actor: context.bot?.username || 'bot',
        resource,
        qty,
        grossProfit
      },
      needDelta: {
        purpose: 10,
        social: 5
      },
      cooldownMs: 6500
    }
  }
}

