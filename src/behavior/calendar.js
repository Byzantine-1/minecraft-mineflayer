function getRealDayStamp(now = Date.now()) {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.floor(now / msPerDay)
}

function getMinecraftDay(bot) {
  if (Number.isFinite(Number(bot?.time?.day))) {
    return Number(bot.time.day)
  }

  if (Number.isFinite(Number(bot?.time?.age))) {
    return Math.floor(Number(bot.time.age) / 24000)
  }

  return getRealDayStamp()
}

function getRawTimeOfDay(bot) {
  if (Number.isFinite(Number(bot?.time?.timeOfDay))) {
    return Number(bot.time.timeOfDay)
  }
  return 6000
}

function getTimeOfDay(bot, authoritySnapshot) {
  const raw = getRawTimeOfDay(bot)
  const longNight = !!authoritySnapshot?.events?.longNight

  if (raw < 1000) {
    return 'dawn'
  }

  if (!longNight && raw < 12000) {
    return 'day'
  }

  if (longNight && raw < 9000) {
    return 'day'
  }

  if (raw < 13500) {
    return 'dusk'
  }

  return 'night'
}

function isNight(bot, authoritySnapshot) {
  const band = getTimeOfDay(bot, authoritySnapshot)
  return band === 'dusk' || band === 'night'
}

function isServiceWindow(dayStamp, timeOfDay, churchConfig) {
  if (!churchConfig || typeof churchConfig !== 'object') {
    return false
  }

  const cadence = Math.max(1, Number(churchConfig.serviceEveryDays) || 3)
  const onServiceDay = dayStamp % cadence === 0
  return onServiceDay && (timeOfDay === 'dawn' || timeOfDay === 'day')
}

module.exports = {
  getRealDayStamp,
  getMinecraftDay,
  getRawTimeOfDay,
  getTimeOfDay,
  isNight,
  isServiceWindow
}
