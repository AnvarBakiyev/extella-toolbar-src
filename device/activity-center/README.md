# Activity Center toolbar integration

This repository owns the Activity Center user interface in
`toolbar/src/panels/activity-center.js` and the toolbar integration test in
`device/activity-center/tests/test_toolbar_integration.py`.

It intentionally contains no device bridge, installer, uninstaller, boot
controller, or duplicate runtime. Those files are canonical in
`extella-marketplace-pack/device/activity-center` and are installed only as
part of a signed, versioned Extella Client transaction. Keeping one runtime
owner prevents a toolbar checkout from starting a second controller or
silently replacing an installed service with an unrelated revision.

## Test

```sh
python3 -m unittest discover -s device/activity-center/tests -v
node --check toolbar/src/panels/activity-center.js
npm run build
```

The generated `toolbar.js` is a packaging input. Do not copy it directly into a
user profile; rebuild and install a complete Extella Client candidate.
