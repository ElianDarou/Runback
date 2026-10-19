# Runback device tests

These tests use `@appetize/playwright` against the standalone Runback phone APK,
not the Appetize demo app. The default build is release 0.1.235, commit
`096c6c68058bba2c64fc4dd0f6f4e60b8d6396aa`.

```sh
npm ci
npm run setup:e2e
npm run test:e2e
```

To test another build, export `APPETIZE_API_TOKEN`, upload its APK with
`appetize build upload ./runback.apk --wait --json`, and set `APPETIZE_BUILD_ID`
to the returned `id`. Use `npm run appetize -- build upload ./runback.apk
--wait --json --quiet` to use the repository's pinned CLI. Keep tokens out
of files and version control.

For new Codex Cloud instances, use Node 24 or later and set the environment's
setup command to `npm ci && npm run setup:e2e` in the repository directory.
Configure `APPETIZE_API_TOKEN` in the cloud environment settings with access
during agent execution, not just during setup. This repository cannot set
account-wide environment secrets. The checked-in agent instructions also tell
new chats how to prepare the tools if the setup command has not run.

The tests use one Pixel 7 session at a time, skip optional setup, and reinstall
the app after each test. They cover empty history and navigation back to Today,
the recording deep link without a watch authorization permit, and the strength
foreground link without an existing session. Authorized watch recording requires
a paired watch and is outside these phone-only tests.

For a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path.
The config detects `/usr/bin/chromium` and uses `HTTPS_PROXY` when present.
`npm run appetize -- <command>` enables Node's environment proxy support.
