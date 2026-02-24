class NarrationDirector {
  constructor({
    runtime,
    nowFn = () => Date.now(),
    minIntervalMs = Number(process.env.NARRATION_MIN_INTERVAL_MS) || 15000,
    perTypeCooldownMs = Number(process.env.NARRATION_TYPE_COOLDOWN_MS) || 45000
  } = {}) {
    this.runtime = runtime
    this.nowFn = nowFn
    this.minIntervalMs = Math.max(5000, Number(minIntervalMs) || 15000)
    this.perTypeCooldownMs = Math.max(10000, Number(perTypeCooldownMs) || 45000)
    this.lastNarrationAt = 0
    this.lastNarrationByType = new Map()
  }

  shouldNarrate(type, force = false) {
    if (force) {
      return true
    }
    const now = this.nowFn()
    if (now - this.lastNarrationAt < this.minIntervalMs) {
      return false
    }
    const lastTypeAt = Number(this.lastNarrationByType.get(type) || 0)
    if (now - lastTypeAt < this.perTypeCooldownMs) {
      return false
    }
    return true
  }

  markNarrated(type) {
    const now = this.nowFn()
    this.lastNarrationAt = now
    this.lastNarrationByType.set(type, now)
  }

  composeLine(event) {
    const type = String(event?.type || '')
    const details = event?.details || {}
    switch (type) {
      case 'permit_issued':
        return '[Crier] Council writ sealed. A frontier permit has been issued.'
      case 'rite_performed':
        return '[Church] Warding rite complete. Keep faith at the gate.'
      case 'portal_opened':
        return '[Militia] Portal watch posted. Perimeter hold begins.'
      case 'expedition_started':
        return '[Crier] The sacred frontier opens. The expedition is underway.'
      case 'expedition_failed':
        return '[Church] Bells toll for the fallen. All hands return to shrine.'
      case 'expedition_ended':
        return details.status === 'failed'
          ? '[Crier] Frontier return marked as failed. Vigil is advised.'
          : '[Crier] Expedition has returned. Offer thanks at first light.'
      case 'npc_death':
        return `[Crier] ${details.name || 'A citizen'} has fallen.`
      case 'replacement_appointed':
        return `[Council] ${details.name || 'A new citizen'} appointed as ${details.role || 'worker'}.`
      default:
        return null
    }
  }

  maybeNarrate(event) {
    if (!event || !event.type) {
      return false
    }

    const force = event.type === 'expedition_failed' || event.type === 'npc_death'
    if (!this.shouldNarrate(event.type, force)) {
      return false
    }

    const line = this.composeLine(event)
    if (!line) {
      return false
    }

    if (this.runtime && typeof this.runtime.broadcast === 'function') {
      this.runtime.broadcast(line)
      this.markNarrated(event.type)
      return true
    }
    return false
  }
}

module.exports = {
  NarrationDirector
}
