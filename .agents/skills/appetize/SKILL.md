---
name: appetize
description: >-
  Run, inspect and control iOS/Android apps on Appetize cloud devices via the
  appetize CLI. Use when running, testing or debugging a mobile app build
  (.app/.apk) on a simulator/emulator — starting sessions, tapping/typing via
  selectors, taking screenshots. Reach for this whenever a task means exercising
  a mobile app on a real device rather than reading its source: verifying a UI
  change, reproducing a bug report, walking through a signup or checkout flow,
  or answering what is currently on screen — even if Appetize is not mentioned
  by name.
metadata:
  cli-version: '0.25.0'
---

# Appetize

Drive an iOS or Android app on a cloud simulator or emulator with the
`appetize` CLI.

**Look before you act, and verify after.** You cannot see the screen, so
`inspect` and `screenshot` are your eyes. Acting blind on remembered coordinates
is the main way these sessions go wrong.

## Prereqs

Run `appetize --version` to confirm the CLI is installed. End every command with
`--json`; if your tool runs commands in a terminal, add `--quiet` too.

`APPETIZE_API_TOKEN` must be set for private APIs and session targets. A target
is a build's public key, e.g. `app_a1b2c3`. Find one with
`appetize build list --app <appId>`, or upload a local build with
`appetize build upload ./app.apk` and use the `id` it prints. Omit the target
for a device with no app installed; that also needs the token.

A device id names a model, e.g. `iphone15pro`;
`appetize device list --platform android` shows each with its OS versions. `APPETIZE_ENDPOINT` points at a non-production
environment.

## Session lifecycle

```bash
appetize session start iphone15pro --target app_a1b2c3 --json
appetize session start iphone15pro --json
appetize session start pixel7 --target app_a1b2c3 --device-os-version 14 --proxy --json
appetize session start iphone15pro --device-orientation landscapeLeft --device-appearance dark --json
```

This blocks until the device is ready; a background daemon then holds the
session open. From its result:

- `sessionId` — what every later command takes
- `adbSerial` — Android only; `adb connect` it to use adb
- `viewerUrl` — local browser viewer for co-driving
- `logs.device` — the app's logs as JSONL; read it for crashes and failed requests
- `logs.network` — with `--proxy`, the app's requests, responses and errors
- `logs.daemon` — the CLI's own output, for when the session misbehaves

```bash
jq 'select(.type == "response") | "\(.response.status) \(.request.method) \(.request.url)"' network.jsonl
```

With one session running, other commands find it automatically; with several,
pass `--session-id <id>`, which also names a session on `session start`. The session's `state.json` sits beside its logs and
shows what it is doing without disturbing it.

Stop the session when you are done, so the device is released:

```bash
appetize session stop --json
```

## The loop

### 1. Inspect first

```bash
appetize inspect --select-test-id login-form --json
```

`inspect` writes the view hierarchy to `inspect.json` and prints its size. Scope
it with a selector, confirm `matches`, then read the file: an unscoped hierarchy
runs past 100 KB and buries what you were looking for.

The tree holds **only what is currently on screen**. Absence means "not visible
right now" — scrolled away or covered — not "does not exist".

### 2. Act through selectors

```bash
appetize tap --select-test-id save --json
appetize tap --select-text '/^item \d+/i' --select-index 2 --json
appetize type 'user@example.com{Tab}hunter2{Enter}' --json
appetize swipe --direction up --json
appetize swipe --from-text 'Drag me' --to-test-id drop-zone --json
```

A `--direction` swipe scrolls; a `--from-*`/`--to-*` pair drags along a path,
naming its ends with the same selectors as `tap`.

```bash
appetize gesture '{byText=Photo}>{wait=800}/' --json
```

`gesture` covers long-presses, double taps and multi-point drags; run
`appetize gesture --help` for its syntax.

Prefer `--select-test-id`, then `--select-text` (exact, or `/regex/flags`). A
selector survives layout changes; a coordinate (`--select-position 0.5,0.75`)
does not, so save those for canvases, maps and sliders.

### 3. Verify

```bash
appetize screenshot after-login --json
```

Screenshot after each meaningful step. A tap that "succeeded" only means the
gesture was delivered — the app may have shown an error, stayed put, or
navigated somewhere unexpected.

### 4. Wait by inspecting, not by sleeping

```bash
appetize inspect --select-test-id home-feed --timeout 5000 --json
```

`--timeout <ms>` returns the moment the element appears and fails if it never
does. Sleeping guesses, and guesses are either slow or flaky.

### 5. Change the code, reinstall, repeat

Keep the session running and put each new build on the device.

On Android, install over adb in seconds:

```bash
adb connect <adbSerial>
adb -s <adbSerial> install -r ./app/build/outputs/apk/debug/app-debug.apk
```

On iOS there is no direct install: the project's CI has to build the `.app` and
upload it to Appetize. Find that workflow, push so it runs, then restart the
session against the new build id. If you cannot tell from the CI configuration
how an iOS build reaches Appetize, stop and ask rather than guessing.

Either way, go back to step 1 — do not assume the new build is running until you
have seen it.

### 6. Show your work

When a step changes what is on screen, read its screenshot into the transcript,
so the person driving sees what you see. When a flow deserves a demo, record it:

```bash
appetize recording start demo --json
# drive the flow
appetize recording stop --json
```

Where you can attach media to a pull request, include it as evidence. Never
commit screenshots or recordings to the repo.

## Troubleshooting

| What you see                         | What to do                                                        |
| ------------------------------------ | ----------------------------------------------------------------- |
| `No active sessions`                 | `session start`; if one should be live, read its `logs.daemon`    |
| `There are multiple active sessions` | Pass `--session-id` for the one you want                          |
| `No session found for id X`          | It ended — `endedReason` in its `state.json` says why             |
| `Session is not ready`               | `state.phase` in `state.json`: queued for capacity, or installing |
| Element not found                    | Re-inspect. It is off screen, covered, or the screen changed      |
| App fails only on network calls      | If you started with `--proxy`, retry without it                   |

## Dismissing the soft keyboard

There is no hide-keyboard command, and tapping an inert element only works if
the app wired that up. Instead, on iOS press return; on Android press back,
which dismisses the keyboard rather than navigating while it is up:

```bash
appetize type '{Enter}' --json
appetize press back --json
```

Confirm with `inspect`: the keyboard is down once Android nodes with
`inputmethod`, `ime` or `latin` in their identifiers, or iOS keys labelled `q`,
`space` and `return`, are gone. A field the keyboard covers is missing from the
tree, which is the usual symptom that sends you here.

Do not change the app under test to make this easier — that changes the thing
you are verifying.

## Deep links

Prefer a deep link over navigating screen by screen:

```bash
appetize open myapp://orders/42 --json
appetize inspect --select-test-id order-42 --timeout 5000 --json
```

`open`, like `session start --launch-url`, only delivers the URL, so wait for the
destination with `inspect --timeout`. A custom scheme needs its app installed.

## Logged-out state

On iOS, `appetize keychain clear` clears the keychain without restarting the
session.

## Full command reference

Run `appetize <command> --help` for flags. `references/commands.md` covers
behaviour and edge cases `--help` does not.
