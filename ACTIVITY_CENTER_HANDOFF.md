# Activity Center — handoff for Claude Code

## Outcome

This branch ports the live-tested Activity Center prototype into the canonical
modular toolbar repository. It must be reviewed and merged from source; do not
copy the installed `~/Library/Application Support/extella-desktop/toolbar.js`
into git.

User-facing behavior:

- a compact status pill lives at the bottom-right of Extella;
- the panel lists active and completed tasks in human language;
- expanding a task shows its source, purpose, execution mode, and safe source id;
- Telegram/WhatsApp/scheduler rows link into automation management;
- Plugins receives a discoverable **Расписания** entry;
- Plugins → Рабочий стол receives a **Регулярные задачи** shortcut.
- **Расписания** shows Extella-registered localhost services, ports, PIDs, and
  launch source, with safe on/off controls.

## Architecture

- `toolbar/src/panels/activity-center.js`: toolbar UI and navigation.
- `device/activity-center/instrumentation/extella_activity_hook.py`: allow-list
  parser loaded in the listener's uv environment.
- `device/activity-center/bridge/`: local API on `127.0.0.1:8799`; activity is
  read-only and service controls are limited to registry-owned local servers.
- `device/activity-center/install.py`: macOS LaunchAgent and listener-hook install.
- `device/boot/restart_local_servers.py`: honors the Activity Center disabled
  set so manually stopped services remain stopped across the 10-minute check.

The device observer never persists raw results, command lines, tokens, or
message bodies. The original diagnostic log contained credentials, so it must
not be committed or attached to an issue.

Service controls use an in-memory token plus an origin allow-list. Raw registry
commands and full project paths never reach the browser. A process is stoppable
only if its cwd or LaunchAgent identity matches the selected registry service.

## Review checklist

1. Review the branch diff against `main`.
2. Run:

   ```bash
   python3 -m unittest discover -s device/activity-center/tests -v
   node --check toolbar/src/panels/activity-center.js
   cd toolbar && node build.js
   ```

3. Deploy the built toolbar plus observer to a test Mac.
4. Restart Extella and verify:
   - `GET http://127.0.0.1:8799/api/health` reports one non-orphan listener;
   - the widget is bottom-right and the old subtitle is absent;
   - Plugins → Расписания opens automation management;
   - Рабочий стол → Регулярные задачи opens the same screen;
   - a fresh Telegram polling row resolves to its scheduler source id.
   - Расписания lists the registered localhost services with real PID values;
   - stopping and starting one non-critical test service updates its port and
     does not affect any other process.
5. Scan the diff for secrets before any push.

## Git handoff

The work is isolated on `feat/activity-center-integration`, based on the fresh
`main` that already contains the `ws-ui` merge. Claude can review this branch,
merge or cherry-pick its commits into the publication branch, and push only
after Anvar explicitly approves the target remote/branch.
