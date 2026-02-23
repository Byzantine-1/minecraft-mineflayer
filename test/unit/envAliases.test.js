const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolveEnvAliases,
  resolveBotNames,
  makeBotProfilesFromEnv
} = require('../../src/bridgeRuntime')

test('resolveEnvAliases prioritizes MC_* over MINECRAFT_* aliases', { timeout: 1000 }, () => {
  const env = {
    BRIDGE_MODE: 'engine_proxy',
    MC_HOST: 'mc-host',
    MINECRAFT_HOST: 'minecraft-host',
    MC_PORT: '25570',
    MINECRAFT_PORT: '25565',
    MC_VERSION: '1.21.4',
    MINECRAFT_VERSION: '1.20.6',
    CHAT_PREFIX: '!'
  }

  const resolved = resolveEnvAliases(env)
  assert.equal(resolved.host, 'mc-host')
  assert.equal(resolved.port, 25570)
  assert.equal(resolved.version, '1.21.4')
  assert.equal(resolved.chatPrefix, '!')
})

test('resolveBotNames uses explicit BOT_NAMES before other bot name env vars', { timeout: 1000 }, () => {
  const env = {
    BOT_NAMES: 'mara,eli',
    BOT_USERNAMES: 'alpha,beta',
    MINECRAFT_USERNAMES: 'gamma'
  }

  assert.deepEqual(resolveBotNames(env, 'engine_proxy'), ['mara', 'eli'])
})

test('resolveBotNames defaults to mara,eli,nox only in engine_proxy mode', { timeout: 1000 }, () => {
  assert.deepEqual(resolveBotNames({}, 'engine_proxy'), ['mara', 'eli', 'nox'])
  assert.deepEqual(resolveBotNames({}, 'autonomous'), ['MaraBot'])
})

test('makeBotProfilesFromEnv maps resolved aliases to each bot profile', { timeout: 1000 }, () => {
  const env = {
    BRIDGE_MODE: 'engine_proxy',
    MC_HOST: '127.0.0.1',
    MC_PORT: '25565',
    MC_VERSION: '1.21.11',
    BOT_NAMES: 'mara,eli'
  }

  const profiles = makeBotProfilesFromEnv(env, { mode: 'engine_proxy' })
  assert.equal(profiles.length, 2)
  assert.equal(profiles[0].host, '127.0.0.1')
  assert.equal(profiles[0].port, 25565)
  assert.equal(profiles[0].version, '1.21.11')
  assert.equal(profiles[0].username, 'mara')
  assert.equal(profiles[1].username, 'eli')
})
