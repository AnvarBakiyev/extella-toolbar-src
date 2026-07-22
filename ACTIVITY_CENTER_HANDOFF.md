# Activity Center — integration handoff

## Outcome

The toolbar provides a compact bottom-right task feed, recurring-task
navigation, and the localhost/PID view in **Plugins → Расписания**. The UI shows
only allow-listed lifecycle data and enables a service control only when the
canonical device runtime proves ownership.

## Ownership boundary

- `toolbar/src/panels/activity-center.js` owns the UI.
- `device/activity-center/tests/test_toolbar_integration.py` owns the toolbar
  contract test.
- `extella-marketplace-pack/device/activity-center` is the sole source of the
  portable bridge, instrumentation, service manager, and lifecycle installer.
- The signed Extella Client transaction is the sole deployment path.

This repository contains no observer installer, LaunchAgent installer, boot
controller, or duplicate Python runtime. Its root `install.sh` is deliberately
fail-closed. Do not copy a generated toolbar into a live profile.

## Review checklist

1. Review the branch diff against the intended toolbar base.
2. Run `npm run build` and every script under `scripts/check-*.js`.
3. Run `python3 -m unittest discover -s device/activity-center/tests -v`.
4. Build the complete signed Extella Client candidate with exact pinned source
   revisions, then run its release gate and platform matrix.
5. Scan the diff and bundle for secrets.
6. Merge, push, or publish only after the owner explicitly approves the exact
   target repository and branch.
