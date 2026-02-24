const test = require('node:test')
const assert = require('node:assert/strict')

const { emitWorldEvent } = require('../../src/events/worldEvents')

test('emitWorldEvent attaches seam metadata and persists through provided stateStore', { timeout: 1000 }, () => {
  const writes = []
  const stored = emitWorldEvent(
    {
      type: 'permit_issued',
      permitId: 'permit-123',
      actor: 'IntentJester8',
      details: {
        reason: 'test'
      }
    },
    {
      stateStore: {
        appendLog(entry) {
          writes.push(entry)
          return { ...entry, persisted: true }
        }
      },
      nowFn: () => Date.UTC(2026, 0, 1, 0, 0, 0)
    }
  )

  assert.equal(stored.persisted, true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].type, 'permit_issued')
  assert.equal(writes[0].source, 'npc-embodiment')
  assert.equal(writes[0].schemaVersion, 1)
  assert.equal(writes[0].ts, '2026-01-01T00:00:00.000Z')
})

test('emitWorldEvent rejects unknown event types', { timeout: 1000 }, () => {
  assert.throws(
    () => emitWorldEvent({ type: 'unknown_event' }, { stateStore: { appendLog: () => ({}) } }),
    /Unknown world event type/
  )
})
