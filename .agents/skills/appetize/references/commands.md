# Command reference

Behaviour that `appetize <command> --help` does not show. Run that for flags.

## Output and exit codes

Results go to stdout and hold only what you could not know beforehand; `{}`
means the command ran. `APPETIZE_OUTPUT` (`json` or `text`) applies when neither
`--json` nor `--no-json` is passed.

Failures exit non-zero and print `{ "error": { "message": "…" } }` to stderr,
plus `hints` when there is something to try, and `sessionDir` once a session is
found. An expired selector `--timeout` is a failure, which is what makes it a
wait.

Session directories live under `~/.appetize/cli/sessions/`, or
`$APPETIZE_CLI_HOME`.

## session start

- Without `--target`, the device starts on its home screen with no app
  installed.
- `--session-id` may use letters, digits, `.`, `-` and `_`. Reusing one fails
  unless `--force` replaces that session.
- `--no-wait` returns just `sessionId` and `logs`, so you can work while the
  device boots.
- `adbSerial` appears only while adb is available, and attaches until the
  session ends.
- `--proxy http://host:port` routes through your own proxy; other schemes are
  rejected. Interception rewrites TLS, so an app that pins certificates may
  fail under it.
- `--device-orientation`, `--device-locale`, `--device-timezone`,
  `--device-location <lat>,<lng>` (`--device-location=-43.5,172.6` when the
  latitude is negative),
  `--device-appearance` and `--device-font-size` set the device up. iOS takes
  `--device-ios-keyboards` (repeatable) and `--no-device-ios-autocorrect`;
  Android takes `--no-device-android-soft-keyboard` and
  `--device-android-shell`, which needs a target.
- `--launch-url` opens a URL once ready. These need a target: `--launch-app`
  (another app id), `--no-launch-app` (skip launching), `--launch-permissions`
  (`grant`), `--launch-params` and, on iOS, `--launch-ios-args`. The last two
  repeat; `--launch-params` takes `key=value`, the value JSON when valid
  (`retries=3` is a number, `'zip="90210"'` a string, `'tags=["qa"]'` an array).
  `=` joins a value starting with `-`.

## session stop

Waits for the daemon to exit, so logs are complete; `--no-wait` only signals
it. Safe to call twice.

## build list

Newest first. Pass a non-null `nextPage` back as `--page` to continue.

## build upload

The extension decides the platform: `.apk` and `.apks` are Android, `.zip`,
`.tar.gz` and `.tgz` are iOS. `appId`, `versionName` and `buildNumber` resolve a
few seconds after upload and are not needed to start a session; `--wait` polls
for them.

## device list

Needs no `APPETIZE_API_TOKEN`. `osVersions` are the values
`--device-os-version` accepts.

## gesture

`--help` holds the syntax and examples. Every element is resolved before the
gesture starts, so a missing one fails without touching the screen; so does a
syntax error, reporting its position.

Android ignores a second tap within 40 ms, and `{wait}` overruns its 300 ms
double-tap window.

## inspect

Writes `{ platform, roots }`: the screen, or one root per match (counted in
`matches`) in `--select-index` order. `.json` is added if you omit an extension.

## type

Typing does not focus a field — tap it first. `{Backspace>16/}` repeats a key
and `{{` types a literal `{`. An unclosed token or unknown key fails without
typing anything.

## open

A scheme-less value is refused. iOS caps URLs at 2048 characters.

## recording start

`.mp4` is added if you omit an extension, any other extension is refused, and
the directory must already exist. Starting while a recording runs fails, as
does an existing file without `--force`.

## recording stop

Fails when nothing is recording. Ending the session closes the file too, and a
session that dies unexpectedly still leaves it playable, losing at most the
last second. A write failure is reported here, not when it happens.

Playback is a constant 30fps, so it does not track real time. A rotation keeps
the original dimensions.

## skill install

Installs into each agent directory already present — `.claude/skills` for
Claude Code, `.agents/skills` for the others — and into both when none is.

## Selectors

`inspect --select-*`, `tap --select-*` and `swipe --from-*`/`--to-*` share the
same suffixes. `-text` is an exact string or `/regex/flags`; `-index` is
0-based. `-test-id` is an exact match: on Android the whole `resource-id` or the
part after its last `/`, on iOS the `accessibilityIdentifier`.

Only `tap` and `swipe` take positions. `-position` is a screen `x,y`, each 0-1;
`-x` and `-y` place the point within the matched element, beyond its edge when
outside 0-1.
