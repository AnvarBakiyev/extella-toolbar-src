# Local-server boot-restart (macOS)

Local-server plugins (excalidraw, howtocook, contract-agent, the adoption-wizard
bridge, …) run as plain processes on fixed ports. A machine **reboot kills them**
and nothing brings them back — the user then opens the plugin and meets a
"needs to set up" card. This restores them automatically.

## What it does
A LaunchAgent runs `restart_local_servers.py` at **login** (and every 10 min as a
safety net). The script reads the plugin registry
(`~/extella-plugins/_registry/*.json`) and, for every `local_server` whose port
isn't already listening, runs its `service.launchCmd` (or a static
`http.server` fallback) detached in its `rootPath`. Idempotent — live ports are
skipped, so it never double-starts anything.

## Install
```bash
./install.sh            # deploy + load LaunchAgent + start everything now
./install.sh --uninstall
```

## Notes
- Pairs with the client-side auto-start in `toolbar/src/core/router.js`: the
  LaunchAgent gets servers up before the user even opens a plugin; router.js is
  the fallback if one is still down when a panel opens.
- Logs: `~/extella-plugins/_boot/restart.log` and `launchagent.{out,err}.log`.
- The Listener could later own this instead of a LaunchAgent (one always-on place
  that already reads the registry) — see the handoff note.
