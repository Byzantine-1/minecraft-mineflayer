const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildEmbodimentRequest,
  createEmbodimentResult,
  parseExecutionResultLine
} = require('../../src/embodiment/contract')

test('buildEmbodimentRequest normalizes accepted execution results into downstream body actions', { timeout: 1000 }, () => {
  const request = buildEmbodimentRequest({
    type: 'execution-result.v1',
    executionId: 'exec-17',
    proposalId: 'proposal-4',
    status: 'accepted',
    actor: { id: 'Mara' },
    statePatch: {
      role: 'brain-should-not-own-this'
    },
    embodiment: {
      backendHint: 'Mineflayer',
      actions: [
        {
          type: 'speech.say',
          actionId: 'say-1',
          text: 'Hold the line.',
          delivery: {
            dedupe: true
          }
        },
        {
          type: 'movement.intent',
          mode: 'approach',
          target: { x: 10, y: 64, z: -4, radius: 2 }
        },
        {
          type: 'interaction.intent',
          interaction: 'use_entity',
          target: { entityId: '7' }
        },
        {
          type: 'ambient.perform',
          gesture: 'jump',
          style: 'ceremonial',
          durationMs: 750
        }
      ]
    }
  })

  assert.deepEqual(request, {
    type: 'embodiment-request.v1',
    schemaVersion: 1,
    sourceType: 'execution-result.v1',
    executionId: 'exec-17',
    proposalId: 'proposal-4',
    actorId: 'mara',
    accepted: true,
    backendHint: 'mineflayer',
    actions: [
      {
        actionId: 'say-1',
        type: 'speech.say',
        actorId: 'mara',
        text: 'Hold the line.',
        channel: 'public',
        delivery: {
          dedupe: true,
          bypassRateLimit: false
        }
      },
      {
        actionId: 'movement-2',
        type: 'movement.intent',
        actorId: 'mara',
        mode: 'approach',
        target: {
          kind: 'position',
          x: 10,
          y: 64,
          z: -4,
          radius: 2
        }
      },
      {
        actionId: 'interaction-3',
        type: 'interaction.intent',
        actorId: 'mara',
        interaction: 'use_entity',
        hand: 'right',
        target: {
          kind: 'entity',
          entityId: '7'
        }
      },
      {
        actionId: 'ambient-4',
        type: 'ambient.perform',
        actorId: 'mara',
        gesture: 'jump',
        style: 'ceremonial',
        durationMs: 750
      }
    ]
  })

  assert.equal('statePatch' in request, false)
})

test('parseExecutionResultLine recognizes execution-result.v1 JSON lines and ignores other stdout noise', { timeout: 1000 }, () => {
  assert.equal(parseExecutionResultLine('Mara: hello'), null)
  assert.equal(parseExecutionResultLine('{"type":"not-the-right-thing"}'), null)

  const parsed = parseExecutionResultLine(
    '{"type":"execution-result.v1","executionId":"exec-2","status":"accepted","actorId":"mara","embodiment":{"actions":[]}}'
  )
  assert.deepEqual(parsed, {
    type: 'execution-result.v1',
    executionId: 'exec-2',
    status: 'accepted',
    actorId: 'mara',
    embodiment: {
      actions: []
    }
  })
})

test('createEmbodimentResult reports partial downstream outcomes without introducing state authority fields', { timeout: 1000 }, () => {
  const request = buildEmbodimentRequest({
    type: 'execution-result.v1',
    executionId: 'exec-3',
    status: 'accepted',
    actorId: 'mara',
    embodiment: {
      actions: [
        { type: 'speech.say', text: 'For the town.' },
        { type: 'movement.intent', mode: 'stop' }
      ]
    }
  })

  const result = createEmbodimentResult({
    request,
    backend: 'mineflayer',
    outcomes: [
      {
        actionId: 'speech-1',
        type: 'speech.say',
        status: 'applied',
        note: 'speech delivered'
      },
      {
        actionId: 'movement-2',
        type: 'movement.intent',
        status: 'failed',
        note: 'movement intent unsupported by bot capabilities'
      }
    ],
    startedAt: '2026-03-01T00:00:00.000Z',
    finishedAt: '2026-03-01T00:00:01.000Z'
  })

  assert.equal(result.status, 'partial')
  assert.deepEqual(result.summary, {
    applied: 1,
    ignored: 0,
    failed: 1
  })
  assert.equal('statePatch' in result, false)
  assert.equal('commandAcceptance' in result, false)
})
