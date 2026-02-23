const mineflayer = require('mineflayer')
const { spawn: spawnChildProcess } = require('child_process')
const readline = require('readline')
const { pathfinder, Movements } = require('mineflayer-pathfinder')

const { WorldAuthority } = require('./behavior/worldAuthority')
const { BotMind } = require('./behavior/botMind')
const { BehaviorOS } = require('./behavior/behaviorOS')
const { IntentRouter } = require('./intents/intentRouter')

const TEST_HANDLER_INSTALL_FLAG = '__bridgeTestHandlersInstalled'

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function resolveBridgeMode(env = process.env) {
  const normalized = String(env?.BRIDGE_MODE || 'autonomous').trim().toLowerCase()
  if (normalized === 'engine_proxy' || normalized === 'proxy' || normalized === 'legacy_proxy') {
    return 'engine_proxy'
  }
  return 'autonomous'
}

function parsePort(value, fallback = 25565) {
  const num = Number(value)
  if (Number.isInteger(num) && num > 0 && num <= 65535) {
    return num
  }
  return fallback
}

function resolveEnvAliases(env = process.env) {
  return {
    mode: resolveBridgeMode(env),
    host: env.MC_HOST || env.MINECRAFT_HOST || env.BOT_HOST || 'localhost',
    port: parsePort(env.MC_PORT || env.MINECRAFT_PORT || env.BOT_PORT, 25565),
    version: env.MC_VERSION || env.MINECRAFT_VERSION || undefined,
    auth: env.MINECRAFT_AUTH || undefined,
    password: env.MINECRAFT_PASSWORD || env.MC_PASSWORD || env.BOT_PASSWORD || undefined,
    chatPrefix: String(env.CHAT_PREFIX || ''),
    engineScript: env.ENGINE_SCRIPT || env.ENGINE_CLI_PATH || '',
    engineCwd: env.ENGINE_CWD || process.cwd(),
    adminUsers: env.ADMIN_USERS || '',
    mineflayerUser: env.MINECRAFT_USERNAME || env.BOT_USERNAME || 'MaraBot'
  }
}

function resolveBotNames(env = process.env, mode = resolveBridgeMode(env)) {
  const botNames = parseList(env.BOT_NAMES)
  if (botNames.length > 0) {
    return botNames
  }

  const explicit = [...parseList(env.BOT_USERNAMES), ...parseList(env.MINECRAFT_USERNAMES)]
  if (explicit.length > 0) {
    return explicit
  }

  if (mode === 'engine_proxy') {
    return ['mara', 'eli', 'nox']
  }

  return [env.MINECRAFT_USERNAME || env.BOT_USERNAME || 'MaraBot']
}

function makeBotProfilesFromEnv(env = process.env, options = {}) {
  const aliases = resolveEnvAliases(env)
  const mode = options.mode || aliases.mode

  if (env.BOTS_JSON) {
    try {
      const parsed = JSON.parse(env.BOTS_JSON)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((profile, index) => ({
          host: aliases.host,
          port: aliases.port,
          version: aliases.version,
          auth: aliases.auth,
          password: aliases.password,
          ...profile,
          username: profile.username || `MaraBot${index + 1}`
        }))
      }
    } catch (error) {
      // Ignore malformed BOTS_JSON and fall through to alias-driven name resolution.
    }
  }

  const usernames = resolveBotNames(env, mode)
  return usernames.map((username) => ({
    host: aliases.host,
    port: aliases.port,
    version: aliases.version,
    auth: aliases.auth,
    password: aliases.password,
    username
  }))
}

function parseChatCommand(message, chatPrefix = '') {
  if (typeof message !== 'string') {
    return null
  }

  const trimmed = message.trim()
  if (!trimmed) {
    return null
  }

  if (chatPrefix && !trimmed.startsWith(chatPrefix)) {
    return null
  }

  const withoutPrefix = chatPrefix ? trimmed.slice(chatPrefix.length).trim() : trimmed
  if (!withoutPrefix) {
    return null
  }

  const pieces = withoutPrefix.split(/\s+/)
  if (pieces.length < 2) {
    return null
  }

  const target = String(pieces[0] || '').toLowerCase()
  const text = pieces.slice(1).join(' ').trim()
  if (!target || !text) {
    return null
  }

  if (target === 'all') {
    return null
  }

  return { target, text }
}

function buildEngineTalkLine(target, text) {
  const safeTarget = String(target || '').trim().toLowerCase()
  const safeText = String(text || '').replace(/[\r\n]+/g, ' ').trim()
  if (!safeTarget || !safeText) {
    return null
  }
  return `talk ${safeTarget} ${safeText}`
}

function parseEngineStdoutLine(line) {
  if (typeof line !== 'string') {
    return null
  }

  const match = /^\s*>?\s*([A-Za-z0-9_]{3,16})\s*:\s*(.+?)\s*$/.exec(line)
  if (!match) {
    return null
  }

  const speaker = String(match[1] || '').trim()
  const message = String(match[2] || '').trim()
  if (!speaker || !message) {
    return null
  }

  return { speaker, message }
}

function shouldForwardEngineLine(line) {
  if (typeof line !== 'string') {
    return false
  }

  const trimmed = line.trim()
  if (!trimmed || trimmed === '>') {
    return false
  }

  return parseEngineStdoutLine(trimmed) !== null
}

function createBackoffDelay(attempt, baseMs, maxMs, jitterMs, rng = Math.random) {
  const safeAttempt = Math.max(0, Number(attempt) || 0)
  const safeBase = Math.max(1, Number(baseMs) || 1)
  const safeMax = Math.max(safeBase, Number(maxMs) || safeBase)
  const safeJitter = Math.max(0, Number(jitterMs) || 0)
  const baseDelay = Math.min(safeMax, safeBase * (2 ** safeAttempt))
  const rand = typeof rng === 'function' ? rng() : Math.random()
  const boundedRand = Math.max(0, Math.min(1, Number(rand) || 0))
  const jitterOffset = Math.round((boundedRand * 2 - 1) * safeJitter)
  return Math.max(0, Math.min(safeMax, baseDelay + jitterOffset))
}

function startEngineProxy({
  spawnImpl = spawnChildProcess,
  engineScript,
  engineCwd = process.cwd(),
  childEnv = process.env,
  nodePath = process.execPath,
  onStdoutLine = () => {},
  onStderr = () => {},
  onExit = () => {},
  logger = () => {},
  forceKillMs = 600
}) {
  const script = String(engineScript || '').trim()
  if (!script) {
    throw new Error('startEngineProxy requires engineScript.')
  }

  const child = spawnImpl(nodePath, [script], {
    cwd: engineCwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let stdoutBuffer = ''
  let exitSent = false
  let shutdownStarted = false
  let forceKillTimer = null

  child.on('exit', (code, signal) => {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer)
      forceKillTimer = null
    }
    onExit({ code, signal })
  })

  if (child.stdout && typeof child.stdout.on === 'function') {
    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '')
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const rawLine of lines) {
        onStdoutLine(rawLine)
      }
    })
  }

  if (child.stderr && typeof child.stderr.on === 'function') {
    child.stderr.on('data', (chunk) => {
      onStderr(String(chunk || ''))
    })
  }

  function sendLine(line) {
    if (!line || child.killed || !child.stdin) {
      return false
    }
    try {
      child.stdin.write(`${String(line).trimEnd()}\n`)
      return true
    } catch (error) {
      logger(`engine stdin write failed: ${error.message}`)
      return false
    }
  }

  function sendExit() {
    if (exitSent) {
      return true
    }
    exitSent = true
    return sendLine('exit')
  }

  function shutdown(reason = 'shutdown') {
    if (shutdownStarted) {
      return
    }
    shutdownStarted = true
    sendExit()

    if (!child.killed) {
      forceKillTimer = setTimeout(() => {
        try {
          if (!child.killed) {
            child.kill()
          }
        } catch (error) {
          logger(`force kill failed (${reason}): ${error.message}`)
        }
      }, Math.max(50, Number(forceKillMs) || 600))
    }
  }

  return {
    process: child,
    sendLine,
    sendExit,
    shutdown,
    isExitSent() {
      return exitSent
    }
  }
}

function installRuntimeProcessHandlers(env = process.env) {
  const testMode =
    String(env.NODE_ENV || '').toLowerCase() === 'test' ||
    String(env.RUNTIME_TEST_MODE || '') === '1'

  if (!testMode) {
    return false
  }

  if (process[TEST_HANDLER_INSTALL_FLAG]) {
    return true
  }

  const rethrow = (error) => {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(String(error))
  }

  process.on('unhandledRejection', rethrow)
  process.on('uncaughtException', rethrow)
  process[TEST_HANDLER_INSTALL_FLAG] = true
  return true
}

function redactBotConfig(config) {
  const copy = { ...config }
  if (copy.password) {
    copy.password = '***'
  }
  return copy
}

class BridgeRuntime {
  constructor(config = {}) {
    this.config = config
    this.env = config.env || process.env
    this.mode = resolveBridgeMode(this.env)
    this.envConfig = resolveEnvAliases(this.env)
    this.proxyPrefix = this.envConfig.chatPrefix

    this.createBotImpl =
      typeof config.createBotImpl === 'function'
        ? config.createBotImpl
        : (botConfig) => mineflayer.createBot(botConfig)
    this.startEngineProxyImpl =
      typeof config.startEngineProxyImpl === 'function'
        ? config.startEngineProxyImpl
        : startEngineProxy
    this.spawnImpl = typeof config.spawnImpl === 'function' ? config.spawnImpl : spawnChildProcess

    this.logFn =
      typeof config.logFn === 'function'
        ? config.logFn
        : (line) => console.log(`${new Date().toISOString()} ${line}`)

    this.bots = new Map()
    this.botNameIndex = new Map()
    this.lastSaid = new Map()
    this.lastChatAtMs = new Map()
    this.chatMinIntervalMs = Math.max(
      0,
      Number(config.chatMinIntervalMs ?? this.env.CHAT_MIN_INTERVAL_MS) || 0
    )
    this.stdinAttached = false
    this.shutdownInitiated = false

    this.engineProxySession = null
    this.engineProcess = null

    if (this.mode === 'autonomous') {
      this.worldAuthority = new WorldAuthority()
      this.intentRouter = new IntentRouter({
        runtime: this,
        worldAuthority: this.worldAuthority,
        adminUsers: this.envConfig.adminUsers
      })
    } else {
      this.worldAuthority = null
      this.intentRouter = null
    }
  }

  log(message) {
    this.logFn(message)
  }

  createBot(profile) {
    const botConfig = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: profile.password,
      version: profile.version,
      auth: profile.auth
    }
    const bot = this.createBotImpl(botConfig)
    if (!bot) {
      throw new Error('createBotImpl returned no bot instance.')
    }

    if (this.mode === 'autonomous' && typeof bot.loadPlugin === 'function') {
      bot.loadPlugin(pathfinder)
    }

    this.attachBot(bot, profile)
    this.log(`[Runtime] creating bot ${JSON.stringify(redactBotConfig(profile))}`)
    return bot
  }

  attachBot(bot, profile = {}) {
    const declaredName = profile.username || bot.username || `bot_${this.bots.size + 1}`
    const lowerName = String(declaredName).toLowerCase()
    let mind = null
    let behavior = null

    if (this.mode === 'autonomous') {
      mind = new BotMind(declaredName)
      behavior = new BehaviorOS({
        bot,
        mind,
        worldAuthority: this.worldAuthority,
        runtime: this
      })
    }

    this.bots.set(declaredName, { bot, mind, behavior })
    this.botNameIndex.set(lowerName, declaredName)

    if (typeof bot.once === 'function') {
      bot.once('spawn', () => {
        if (this.shutdownInitiated) {
          return
        }

        if (this.mode === 'autonomous') {
          try {
            if (bot.pathfinder && typeof bot.pathfinder.setMovements === 'function') {
              bot.pathfinder.setMovements(new Movements(bot))
            }
          } catch (error) {
            this.log(`[Runtime:${declaredName}] movement setup failed: ${error.message}`)
          }

          behavior.start()
          this.log(`[Runtime:${declaredName}] spawned and behavior loop started.`)
        } else {
          this.log(`[Runtime:${declaredName}] spawned in engine_proxy mode.`)
        }
      })
    }

    if (typeof bot.on === 'function') {
      bot.on('chat', (username, message) => {
        if (!username || username === bot.username) {
          return
        }

        if (this.mode === 'autonomous') {
          this.intentRouter.handleChat({
            botName: declaredName,
            username,
            message
          })
        } else {
          this.handleProxyChat({
            username,
            message
          })
        }
      })

      bot.on('kicked', (reason) => {
        this.log(`[Runtime:${declaredName}] kicked: ${String(reason)}`)
        if (behavior) {
          behavior.stop('kicked')
        }
      })

      bot.on('end', () => {
        this.log(`[Runtime:${declaredName}] connection ended.`)
        if (behavior) {
          behavior.stop('disconnect')
        }
      })

      bot.on('error', (error) => {
        this.log(`[Runtime:${declaredName}] error: ${error?.message || String(error)}`)
      })
    }
  }

  attachStdin() {
    if (this.config.attachStdin === false) {
      return
    }
    if (this.stdinAttached || !process.stdin || !process.stdin.isTTY && process.stdin.readableEnded) {
      return
    }

    this.stdinAttached = true
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    })

    rl.on('line', (line) => {
      if (this.mode === 'autonomous') {
        this.intentRouter.handleStdin(line)
      } else {
        const trimmed = String(line || '').trim()
        if (!trimmed) {
          return
        }
        this.sendToEngine(trimmed)
      }
    })

    this.log(`[Runtime] stdin listener attached (${this.mode}).`)
  }

  handleEngineStdoutLine(line) {
    if (!shouldForwardEngineLine(line)) {
      return
    }

    const parsed = this.parseEngineReplyLine(line)
    if (!parsed) {
      return
    }

    this.sendChat(parsed.botName, parsed.message, {
      dedupe: true
    })
  }

  ensureEngineProxyProcess() {
    if (this.mode !== 'engine_proxy') {
      return
    }
    if (this.engineProxySession) {
      return
    }

    const engineScript = this.envConfig.engineScript
    if (!engineScript) {
      throw new Error('engine_proxy mode requires ENGINE_SCRIPT (or ENGINE_CLI_PATH).')
    }

    this.engineProxySession = this.startEngineProxyImpl({
      spawnImpl: this.spawnImpl,
      engineScript,
      engineCwd: this.envConfig.engineCwd,
      childEnv: { ...process.env, ...this.env },
      onStdoutLine: (line) => this.handleEngineStdoutLine(line),
      onStderr: (text) => {
        if (text) {
          process.stderr.write(`[Engine STDERR] ${text}`)
        }
      },
      onExit: ({ code }) => {
        this.log(`[EngineProxy] engine exited with code ${code}`)
      },
      logger: (line) => this.log(`[EngineProxy] ${line}`),
      forceKillMs: Number(this.env.ENGINE_FORCE_KILL_MS) || 600
    })

    this.engineProcess = this.engineProxySession.process
    this.log(
      `[EngineProxy] started engine script ${engineScript} (cwd=${this.envConfig.engineCwd})`
    )
  }

  startFromEnv() {
    if (this.mode === 'engine_proxy') {
      this.ensureEngineProxyProcess()
    }

    const profiles = makeBotProfilesFromEnv(this.env, { mode: this.mode })
    if (profiles.length === 0) {
      throw new Error('No bot profile configured.')
    }

    for (const profile of profiles) {
      this.createBot(profile)
    }

    this.attachStdin()
  }

  getDefaultBotName() {
    const first = this.bots.keys().next()
    return first.done ? null : first.value
  }

  resolveBotRecord(botName) {
    if (botName && this.bots.has(botName)) {
      return this.bots.get(botName)
    }
    const defaultName = this.getDefaultBotName()
    return defaultName ? this.bots.get(defaultName) : null
  }

  setBotMode(botName, mode) {
    if (this.mode !== 'autonomous') {
      return {
        ok: false,
        error: 'Mode control unavailable in engine_proxy mode.',
        mode: null
      }
    }

    const record = this.resolveBotRecord(botName)
    if (!record) {
      return { ok: false, error: 'No active bot found.', mode: null }
    }

    const nextMode = record.mind.setMode(mode)
    return { ok: true, mode: nextMode }
  }

  setBotRole(botName, role, source = 'command') {
    if (this.mode !== 'autonomous') {
      return { ok: false, error: 'Role control unavailable in engine_proxy mode.' }
    }

    const record = this.resolveBotRecord(botName)
    if (!record) {
      return { ok: false, error: 'No active bot found.' }
    }

    return record.mind.setRoleOverride(role, source)
  }

  stopActiveTask(botName) {
    if (this.mode !== 'autonomous') {
      return false
    }

    const record = this.resolveBotRecord(botName)
    if (!record) {
      return false
    }

    return record.behavior.stopActiveTask()
  }

  sendChat(botName, message, options = {}) {
    const record = this.resolveBotRecord(botName)
    if (!record?.bot || typeof record.bot.chat !== 'function') {
      this.log(`[Chat] ${message}`)
      return false
    }

    const text = String(message || '').trim()
    if (!text) {
      return false
    }

    const key = String(record.bot.username || botName).toLowerCase()
    if (options.dedupe) {
      if (this.lastSaid.get(key) === text) {
        return false
      }
      this.lastSaid.set(key, text)
    }

    const nowMs = Date.now()
    if (!options.bypassRateLimit && this.chatMinIntervalMs > 0) {
      const lastAt = Number(this.lastChatAtMs.get(key) || 0)
      if (nowMs - lastAt < this.chatMinIntervalMs) {
        return false
      }
    }
    this.lastChatAtMs.set(key, nowMs)

    try {
      record.bot.chat(text.slice(0, 240))
      return true
    } catch (error) {
      this.log(`[Chat:${botName}] failed: ${error.message}`)
      return false
    }
  }

  broadcast(message) {
    const text = String(message || '').trim()
    if (!text) {
      return
    }

    for (const botName of this.bots.keys()) {
      this.sendChat(botName, text)
    }
  }

  parseProxyIncomingChat(message) {
    const parsed = parseChatCommand(message, this.proxyPrefix)
    if (!parsed) {
      return null
    }
    if (!this.botNameIndex.has(parsed.target)) {
      return null
    }
    return parsed
  }

  handleProxyChat({ username, message }) {
    if (this.mode !== 'engine_proxy') {
      return false
    }

    const speakerLower = String(username || '').toLowerCase()
    if (!speakerLower) {
      return false
    }

    // Ignore chat emitted by configured bridge bot names to prevent loops.
    if (this.botNameIndex.has(speakerLower)) {
      return false
    }

    const parsed = this.parseProxyIncomingChat(message)
    if (!parsed) {
      return false
    }

    const line = buildEngineTalkLine(parsed.target, parsed.text)
    if (!line) {
      return false
    }

    this.sendToEngine(line)
    return true
  }

  parseEngineReplyLine(rawLine) {
    const parsed = parseEngineStdoutLine(String(rawLine || ''))
    if (!parsed) {
      return null
    }

    const botName = this.botNameIndex.get(parsed.speaker.toLowerCase())
    if (!botName) {
      return null
    }

    return {
      botName,
      speaker: parsed.speaker,
      message: parsed.message
    }
  }

  sendToEngine(line) {
    if (!line || this.mode !== 'engine_proxy') {
      return false
    }
    if (!this.engineProxySession) {
      this.log('[EngineProxy] engine process unavailable; cannot forward command.')
      return false
    }
    return this.engineProxySession.sendLine(String(line))
  }

  shutdown(reason = 'shutdown') {
    if (this.shutdownInitiated) {
      return
    }
    this.shutdownInitiated = true
    this.log(`[Runtime] shutting down (${reason})`)

    if (this.mode === 'engine_proxy' && this.engineProxySession) {
      this.engineProxySession.sendExit()
    }

    for (const [botName, entry] of this.bots.entries()) {
      if (entry.behavior) {
        entry.behavior.stop(reason)
      }

      try {
        if (entry.bot && typeof entry.bot.quit === 'function') {
          entry.bot.quit(reason)
        }
      } catch (error) {
        this.log(`[Runtime:${botName}] quit failed: ${error.message}`)
      }
    }

    if (this.mode === 'engine_proxy' && this.engineProxySession) {
      this.engineProxySession.shutdown(reason)
    }
  }
}

module.exports = {
  BridgeRuntime,
  resolveBridgeMode,
  resolveEnvAliases,
  resolveBotNames,
  makeBotProfilesFromEnv,
  parseChatCommand,
  buildEngineTalkLine,
  parseEngineStdoutLine,
  shouldForwardEngineLine,
  createBackoffDelay,
  startEngineProxy,
  installRuntimeProcessHandlers
}
