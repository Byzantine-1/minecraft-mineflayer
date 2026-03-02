# minecraft-mineflayer

Bridge/runtime layer for Mineflayer bots with two modes:

- `autonomous` (Behavior OS loop)
- `engine_proxy` (forwards legacy `talk/god/exit` lines and `execution-handoff.v1` JSON to the external engine)

Embodiment seam:

- accepted `execution-result.v1` JSON lines can now carry downstream `embodiment.actions`
- the bridge normalizes those actions into `embodiment-request.v1` and applies them through a Mineflayer adapter
- supported body actions are `speech.say`, `movement.intent`, `interaction.intent`, and `ambient.perform`
- outcome reporting is emitted as `embodiment-result.v1` / `embodiment-event.v1`
- Mineflayer remains downstream only: no proposal selection, no command acceptance, no shadow-state authority

## Expedition v0 + Mortality

Bridge-local durable shadow state now lives under `state/`:

- `state/settlement.json`: portal state, permit/cooldown, expedition lifecycle, local laws
- `state/roster.json`: citizen mortality/roles/reputation
- `state/logbook.jsonl`: append-only governance/expedition/death log entries
- `state/hudSnapshot.json`: compact HUD payload for downstream scoreboard/plugin adapters

World event seam:

- `src/events/worldEvents.js` exposes `emitWorldEvent(...)`
- persisted events are stamped with `ts`, `source: "npc-embodiment"`, and `schemaVersion: 1`
- expedition/death/replacement flows now emit through this seam

Narration beats:

- bounded crier/church/militia beats are emitted on key world events
- throttled by `NARRATION_MIN_INTERVAL_MS` and `NARRATION_TYPE_COOLDOWN_MS`

In `autonomous` mode, the bridge supports expedition/governance commands:

- `!all council permit expedition <reason>`
- `!all church rite warding <permitId>`
- `!all portal open <permitId>`
- `!all portal seal`
- `!all expedition start <permitId> <playerName>`
- `!all expedition fail player_death`
- `!all expedition end [success|failed]`
- `!all council appoint <newName> <role>`

Admin-only commands are gated by `ADMIN_USERS` (CSV allowlist).

NPC mortality is permanent:

- On bot `death`, the citizen is marked dead in `state/roster.json`
- Death is logged to `state/logbook.jsonl`
- Dead citizens do not respawn automatically on next startup
- Appointment is required to add replacement citizens

## Testing

Run syntax checks:

```powershell
npm run lint:check
```

Run full test suite:

```powershell
npm test
```

Run proxy smoke test:

```powershell
npm run smoke:proxy
```

Run autonomous smoke test:

```powershell
npm run smoke:auto
```

Run CI-style local gate:

```powershell
npm run ci
```

## Expedition Playtest Flow

Run the sequence:

1. `!all council permit expedition scout_near_fortress`
2. `!all church rite warding <permitId>`
3. `!all portal open <permitId>`
4. `!all expedition start <permitId> <playerName>`
5. `!all expedition fail player_death` or `!all expedition end success`

Verify:

- `!all settlement status` reports portal/expedition status and roster alive/dead counts
- `state/logbook.jsonl` includes permit, start, fail/end entries
