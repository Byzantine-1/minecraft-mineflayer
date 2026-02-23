# minecraft-mineflayer

Bridge/runtime layer for Mineflayer bots with two modes:

- `autonomous` (Behavior OS loop)
- `engine_proxy` (forwards chat to external engine `talk/god/exit` command plane)

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
