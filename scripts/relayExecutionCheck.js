const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { BridgeRuntime, buildExecutionHandoffLine } = require('../src/bridgeRuntime')
const { parseExecutionResultLine } = require('../src/embodiment/contract')
const { createFakeBot } = require('../test/helpers/fakeBot')
const { waitFor } = require('../test/helpers/waitFor')

const REPO_ROOT = path.resolve(__dirname, '..')
const DEFAULT_ENGINE_REPO_ROOT = path.resolve(REPO_ROOT, '..', 'minecraft-god-mvp')
const FIXED_NOW_ISO = '2026-02-25T00:00:00.000Z'

function requireEngineModule(engineRepoRoot, relativePath) {
  return require(path.join(engineRepoRoot, relativePath))
}

function resolveEnginePaths(options = {}, env = process.env) {
  const engineRepoRoot = path.resolve(
    options.engineRepoRoot || env.ENGINE_REPO_ROOT || DEFAULT_ENGINE_REPO_ROOT
  )
  const engineEntryPath = path.resolve(
    options.engineEntryPath || env.ENGINE_ENTRY_PATH || path.join(engineRepoRoot, 'src', 'index.js')
  )

  return {
    engineRepoRoot,
    engineEntryPath
  }
}

function createSilentLoggerFactory(engineRepoRoot) {
  const { createLogger } = requireEngineModule(engineRepoRoot, 'src/logger.js')
  return function createSilentLogger(component) {
    return createLogger({
      component,
      minLevel: 'error',
      sink: {
        log() {},
        error() {}
      }
    })
  }
}

function createTempPaths(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    dir,
    memoryPath: path.join(dir, 'memory.json'),
    stateDir: path.join(dir, 'bridge-state')
  }
}

function fixedNowFactory() {
  return () => Date.parse(FIXED_NOW_ISO)
}

function buildId(prefix, payload) {
  return `${prefix}_${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
}

function createAgents() {
  return [
    { name: 'Mara', faction: 'Pilgrims', applyGodCommand: () => {} },
    { name: 'Eli', faction: 'Pilgrims', applyGodCommand: () => {} }
  ]
}

function createHandoff({
  proposalType,
  command,
  args,
  townId = 'alpha',
  actorId = 'mara',
  decisionEpoch = 1,
  snapshotHash = 'a'.repeat(64),
  preconditions = []
}) {
  const proposalId = buildId('proposal', {
    proposalType,
    command,
    args,
    townId,
    actorId,
    decisionEpoch
  })
  const handoffId = buildId('handoff', {
    proposalId,
    command
  })

  return {
    schemaVersion: 'execution-handoff.v1',
    handoffId,
    advisory: true,
    proposalId,
    idempotencyKey: proposalId,
    snapshotHash,
    decisionEpoch,
    proposal: {
      schemaVersion: 'proposal.v2',
      proposalId,
      snapshotHash,
      decisionEpoch,
      type: proposalType,
      actorId,
      townId,
      priority: 0.9,
      reason: 'Mineflayer live relay validation.',
      reasonTags: ['integration-test'],
      args
    },
    command,
    executionRequirements: {
      expectedSnapshotHash: snapshotHash,
      expectedDecisionEpoch: decisionEpoch,
      preconditions
    }
  }
}

function stateFile(stateDir, fileName) {
  return path.join(stateDir, fileName)
}

function pickStableExecutionProjection(result) {
  return {
    type: result.type,
    schemaVersion: result.schemaVersion,
    handoffId: result.handoffId,
    proposalId: result.proposalId,
    idempotencyKey: result.idempotencyKey,
    snapshotHash: result.snapshotHash,
    decisionEpoch: result.decisionEpoch,
    actorId: result.actorId,
    townId: result.townId,
    proposalType: result.proposalType,
    command: result.command,
    authorityCommands: result.authorityCommands,
    status: result.status,
    accepted: result.accepted,
    executed: result.executed,
    reasonCode: result.reasonCode,
    evaluation: result.evaluation,
    worldState: result.worldState,
    ...(Object.prototype.hasOwnProperty.call(result, 'embodiment')
      ? { embodiment: result.embodiment }
      : {})
  }
}

function pickStableRelayProjection(run) {
  return {
    sentHandoffLine: run.sentHandoffLine,
    execution: pickStableExecutionProjection(run.result),
    relayCompletion: {
      status: run.completionEvent?.status || null,
      summary: run.completionEvent?.summary || null
    },
    receipt: {
      handoffId: run.receipt?.handoffId || null,
      proposalId: run.receipt?.proposalId || null,
      idempotencyKey: run.receipt?.idempotencyKey || null,
      actorId: run.receipt?.actorId || null,
      townId: run.receipt?.townId || null,
      proposalType: run.receipt?.proposalType || null,
      command: run.receipt?.command || null,
      authorityCommands: run.receipt?.authorityCommands || [],
      status: run.receipt?.status || null,
      reasonCode: run.receipt?.reasonCode || null,
      actualSnapshotHash: run.receipt?.actualSnapshotHash || null,
      actualDecisionEpoch: run.receipt?.actualDecisionEpoch || null,
      postExecutionSnapshotHash: run.receipt?.postExecutionSnapshotHash || null,
      postExecutionDecisionEpoch: run.receipt?.postExecutionDecisionEpoch || null
    },
    projectStage: run.projectStage
  }
}

function waitForProcessClose(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!child) {
      reject(new Error('Engine child process is unavailable.'))
      return
    }

    const timeout = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      reject(new Error(`Timed out waiting for engine child exit after ${timeoutMs}ms`))
    }, timeoutMs)

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
  })
}

function createSeedingContext(engineRepoRoot, memoryPath) {
  const createSilentLogger = createSilentLoggerFactory(engineRepoRoot)
  const { createMemoryStore } = requireEngineModule(engineRepoRoot, 'src/memory.js')
  const {
    createExecutionStore,
    createMemoryExecutionPersistence
  } = requireEngineModule(engineRepoRoot, 'src/executionStore.js')
  const { createGodCommandService } = requireEngineModule(engineRepoRoot, 'src/godCommands.js')
  const { createAuthoritativeSnapshotProjection } = requireEngineModule(
    engineRepoRoot,
    'src/worldSnapshotProjection.js'
  )

  const now = fixedNowFactory()
  const logger = createSilentLogger('relay_execution_seed')
  const memoryStore = createMemoryStore({
    filePath: memoryPath,
    now,
    logger: logger.child({ subsystem: 'memory' })
  })
  const executionStore = createExecutionStore({
    memoryStore,
    persistenceBackend: createMemoryExecutionPersistence({ memoryStore }),
    logger: logger.child({ subsystem: 'execution_store' })
  })
  const godCommandService = createGodCommandService({
    memoryStore,
    logger: logger.child({ subsystem: 'god_commands' })
  })

  return {
    memoryStore,
    executionStore,
    godCommandService,
    snapshotHash() {
      return createAuthoritativeSnapshotProjection(memoryStore.recallWorld()).snapshotHash
    }
  }
}

async function seedExecutionState(context) {
  const agents = createAgents()

  await context.memoryStore.transact((memory) => {
    memory.world.clock.updated_at = FIXED_NOW_ISO
  }, { eventId: 'relay-execution:seed-clock' })

  await context.godCommandService.applyGodCommand({
    agents,
    command: 'mark add alpha_hall 0 64 0 town:alpha',
    operationId: 'relay-execution:seed-town-alpha'
  })
  await context.godCommandService.applyGodCommand({
    agents,
    command: 'project start alpha lantern_line',
    operationId: 'relay-execution:seed-project-alpha'
  })

  const projectId = context.memoryStore.getSnapshot().world.projects[0].id
  const handoff = createHandoff({
    proposalType: 'PROJECT_ADVANCE',
    command: `project advance alpha ${projectId}`,
    args: { projectId },
    snapshotHash: context.snapshotHash(),
    preconditions: [{ kind: 'project_exists', targetId: projectId }]
  })

  return {
    handoff,
    projectId
  }
}

function createReloadedExecutionStore(engineRepoRoot, memoryPath) {
  const createSilentLogger = createSilentLoggerFactory(engineRepoRoot)
  const { createMemoryStore } = requireEngineModule(engineRepoRoot, 'src/memory.js')
  const {
    createExecutionStore,
    createMemoryExecutionPersistence
  } = requireEngineModule(engineRepoRoot, 'src/executionStore.js')

  const logger = createSilentLogger('relay_execution_verify')
  const memoryStore = createMemoryStore({
    filePath: memoryPath,
    logger: logger.child({ subsystem: 'memory' })
  })
  const executionStore = createExecutionStore({
    memoryStore,
    persistenceBackend: createMemoryExecutionPersistence({ memoryStore }),
    logger: logger.child({ subsystem: 'execution_store' })
  })

  return {
    memoryStore,
    executionStore
  }
}

async function runSingleRelayExecutionCheck(options = {}) {
  const { engineRepoRoot, engineEntryPath } = resolveEnginePaths(options, process.env)
  const tempPaths = createTempPaths('mmf-live-relay-')
  const seedingContext = createSeedingContext(engineRepoRoot, tempPaths.memoryPath)
  const seeded = await seedExecutionState(seedingContext)
  const engineStdoutLines = []
  const engineResultLines = []
  const outboundLines = []
  const relayedResults = []
  const embodimentResults = []
  const embodimentEvents = []

  const runtime = new BridgeRuntime({
    env: {
      BRIDGE_MODE: 'engine_proxy',
      ENGINE_SCRIPT: engineEntryPath,
      ENGINE_CWD: engineRepoRoot,
      BOT_NAMES: 'mara',
      CHAT_PREFIX: '!',
      STATE_DIR: tempPaths.stateDir,
      MEMORY_STORE_FILE_PATH: tempPaths.memoryPath,
      LOG_MIN_LEVEL: 'error'
    },
    createBotImpl: (botConfig) => createFakeBot({ username: botConfig.username }),
    emitEmbodimentEventFn: (event) => embodimentEvents.push(event),
    attachStdin: false,
    chatMinIntervalMs: 0,
    logFn: () => {}
  })

  const originalHandleEngineStdoutLine = runtime.handleEngineStdoutLine.bind(runtime)
  runtime.handleEngineStdoutLine = (line) => {
    const normalizedLine = String(line)
    engineStdoutLines.push(normalizedLine)
    if (parseExecutionResultLine(normalizedLine)) {
      engineResultLines.push(normalizedLine)
    }
    return originalHandleEngineStdoutLine(normalizedLine)
  }

  const originalEmbodyExecutionResult = runtime.embodyExecutionResult.bind(runtime)
  runtime.embodyExecutionResult = async (executionResult) => {
    relayedResults.push(executionResult)
    const embodimentResult = await originalEmbodyExecutionResult(executionResult)
    embodimentResults.push(embodimentResult)
    return embodimentResult
  }

  let closeResult = null
  try {
    runtime.startFromEnv()
    const maraBot = runtime.resolveBotRecord('mara').bot

    await waitFor(
      () => engineStdoutLines.some((line) => line.includes('--- WORLD ONLINE ---')),
      5000
    )

    const originalSendLine = runtime.engineProxySession.sendLine.bind(runtime.engineProxySession)
    runtime.engineProxySession.sendLine = (line) => {
      outboundLines.push(String(line))
      return originalSendLine(line)
    }

    const expectedHandoffLine = buildExecutionHandoffLine(seeded.handoff)
    assert.equal(runtime.submitExecutionHandoff(seeded.handoff), true)

    await waitFor(
      () => embodimentEvents.some((event) => event.event === 'request.completed'),
      8000
    )

    runtime.shutdown('relay-execution-check')
    closeResult = await waitForProcessClose(runtime.engineProcess, 8000)

    const sentHandoffLines = outboundLines.filter((line) => line.trim().startsWith('{'))
    const completionEvent = embodimentEvents.find((event) => event.event === 'request.completed') || null
    const result = relayedResults[0]
    const embodimentResult = embodimentResults[0] || null

    assert.equal(closeResult.code, 0, `engine exited with code ${closeResult.code}`)
    assert.equal(sentHandoffLines.length, 1, 'expected exactly one canonical handoff line sent through the bridge')
    assert.equal(sentHandoffLines[0], expectedHandoffLine)
    assert.equal(outboundLines.some((line) => line.startsWith('god ')), false)
    assert.equal(outboundLines.some((line) => line.startsWith('talk ')), false)
    assert.equal(engineResultLines.length, 1, 'expected exactly one canonical execution result line from the engine')
    assert.equal(relayedResults.length, 1, 'expected one parsed execution result relayed downstream')
    assert(result, 'expected parsed execution-result.v1 payload')
    assert.equal(result.type, 'execution-result.v1')
    assert.equal(result.schemaVersion, 1)
    assert.equal(result.handoffId, seeded.handoff.handoffId)
    assert.equal(result.proposalId, seeded.handoff.proposalId)
    assert.equal(result.idempotencyKey, seeded.handoff.idempotencyKey)
    assert.equal(result.status, 'executed')
    assert.equal(result.accepted, true)
    assert.equal(result.executed, true)
    assert.equal(result.reasonCode, 'EXECUTED')
    assert.match(String(result.snapshotHash || ''), /^[0-9a-f]{64}$/)
    assert(Array.isArray(result.authorityCommands))
    assert.equal(result.authorityCommands.length, 1)
    assert.equal(result.authorityCommands[0], `project advance alpha ${seeded.projectId}`)
    assert.match(String(result.evaluation?.staleCheck?.actualSnapshotHash || ''), /^[0-9a-f]{64}$/)
    assert.match(String(result.worldState?.postExecutionSnapshotHash || ''), /^[0-9a-f]{64}$/)
    assert.equal(result.command, `project advance alpha ${seeded.projectId}`)
    assert.equal(completionEvent?.status, 'ignored')
    assert.deepEqual(completionEvent?.summary, {
      applied: 0,
      ignored: 0,
      failed: 0
    })
    assert.equal(embodimentResult?.status, 'ignored')
    assert.equal(maraBot.chats.length, 0)
    assert.equal(maraBot.swingArmCalls.length, 0)
    assert.equal(maraBot.activateItemCalls, 0)
    assert.equal(fs.existsSync(stateFile(tempPaths.stateDir, 'settlement.json')), false)
    assert.equal(fs.existsSync(stateFile(tempPaths.stateDir, 'roster.json')), false)
    assert.equal(fs.existsSync(stateFile(tempPaths.stateDir, 'logbook.jsonl')), false)

    const reloaded = createReloadedExecutionStore(engineRepoRoot, tempPaths.memoryPath)
    const receipt = reloaded.executionStore.findReceipt({
      handoffId: seeded.handoff.handoffId,
      idempotencyKey: seeded.handoff.idempotencyKey
    })
    const pendingExecutions = reloaded.executionStore.listPendingExecutions()
    const executedProject = reloaded.memoryStore.getSnapshot().world.projects.find(
      (entry) => entry.id === seeded.projectId
    )

    assert(receipt, 'expected durable execution receipt after live relay')
    assert.equal(receipt.handoffId, seeded.handoff.handoffId)
    assert.equal(receipt.idempotencyKey, seeded.handoff.idempotencyKey)
    assert.equal(receipt.status, 'executed')
    assert.equal(pendingExecutions.length, 0, 'pending execution markers should be cleared after success')
    assert(executedProject, 'expected seeded project to still exist after live relay')
    assert.equal(executedProject.stage, 2)

    return {
      handoff: seeded.handoff,
      sentHandoffLine: sentHandoffLines[0],
      result,
      receipt,
      pendingExecutions,
      completionEvent,
      embodimentResult,
      engineStdoutLines,
      outboundLines,
      capturedLiveFromChildProcess: true,
      projectStage: executedProject.stage
    }
  } finally {
    runtime.shutdown('relay-execution-check-finally')
    if (runtime.engineProcess && !closeResult) {
      try {
        await waitForProcessClose(runtime.engineProcess, 4000)
      } catch {}
    }
  }
}

async function runRelayExecutionCheck(options = {}) {
  const firstRun = await runSingleRelayExecutionCheck(options)
  const secondRun = await runSingleRelayExecutionCheck(options)

  assert.deepEqual(
    pickStableRelayProjection(secondRun),
    pickStableRelayProjection(firstRun),
    'same seeded relay execution should produce deterministic bridge semantics'
  )

  return {
    ...firstRun,
    deterministicReplayVerified: true
  }
}

function parseCliOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--engine-repo-root') {
      options.engineRepoRoot = argv[index + 1]
      index += 1
      continue
    }
    if (token === '--engine-entry-path') {
      options.engineEntryPath = argv[index + 1]
      index += 1
    }
  }
  return options
}

module.exports = {
  runRelayExecutionCheck
}

if (require.main === module) {
  runRelayExecutionCheck(parseCliOptions(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write('Relay execution check passed. Captured canonical execution-result.v1 from a real engine child process.\n')
      process.stdout.write(`${JSON.stringify(result.result)}\n`)
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
