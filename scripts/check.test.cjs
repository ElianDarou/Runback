const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runback-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const folder of ['scripts', 'bin', 'node_modules/.bin', 'android']) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, 'check.cjs'), path.join(root, 'scripts/check.cjs'));
  for (const binary of ['eslint', 'tsc', 'jest']) {
    fs.writeFileSync(path.join(root, 'node_modules/.bin', binary), '');
  }
  const recorder = `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CHECK_LOG, JSON.stringify({args, cwd: process.cwd(), tz: process.env.TZ}) + '\\n');
if (args.join(' ') === process.env.CHECK_FAIL) process.exit(7);
if (process.env.CHECK_SIGNAL) process.kill(process.pid, 'SIGTERM');
`;
  fs.writeFileSync(path.join(root, 'bin/npm'), `#!${process.execPath}\n${recorder}`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'scripts/record.cjs'), recorder);
  // Keep this non-executable to cover the historical wrapper permission failure.
  fs.writeFileSync(path.join(root, 'android/gradlew'),
    'node "$CHECK_RECORDER" gradle "$@"\n', { mode: 0o644 });
  const env = {
    ...process.env,
    PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    ANDROID_HOME: '', ANDROID_SDK_ROOT: '', TZ: 'UTC',
    CHECK_LOG: path.join(root, 'commands.jsonl'),
    CHECK_RECORDER: path.join(root, 'scripts/record.cjs'),
    CHECK_FAIL: '', CHECK_SIGNAL: '',
  };
  return {
    root,
    run(args = [], extraEnv = {}) {
      return spawnSync(process.execPath, [path.join(root, 'scripts/check.cjs'), ...args], {
        cwd: os.tmpdir(), env: { ...env, ...extraEnv }, encoding: 'utf8',
      });
    },
    commands() {
      return fs.existsSync(env.CHECK_LOG)
        ? fs.readFileSync(env.CHECK_LOG, 'utf8').trim().split('\n').map(line => JSON.parse(line))
        : [];
    },
  };
}

// The fixtures replace POSIX executables; production dispatch also supports Windows.
const options = { skip: process.platform === 'win32' };

test('checks run from the repository with the CI timezone, even from another cwd', options, t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const commands = f.commands();
  assert.deepEqual(commands.map(c => c.args), [
    ['run', 'lint'], ['run', 'test:tooling'], ['run', 'typecheck'], ['test', '--', '--runInBand'],
  ]);
  assert.ok(commands.every(c => c.cwd === f.root && c.tz === 'Europe/Berlin'));
});

test('the first failing check stops validation and preserves its exit code', options, t => {
  const f = fixture(t);
  assert.equal(f.run([], { CHECK_FAIL: 'run typecheck' }).status, 7);
  assert.deepEqual(f.commands().map(c => c.args), [
    ['run', 'lint'], ['run', 'test:tooling'], ['run', 'typecheck'],
  ]);
});

test('a terminated check cannot be reported as successful', options, t => {
  const f = fixture(t);
  assert.equal(f.run([], { CHECK_SIGNAL: 'yes' }).status, 1);
  assert.equal(f.commands().length, 1);
});

test('missing dependencies give an installation command before any check runs', options, t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'node_modules/.bin/tsc'));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm ci/);
  assert.deepEqual(f.commands(), []);
});

test('unknown or repeated options fail instead of silently skipping native checks', options, t => {
  for (const args of [['--native'], ['--android', '--android']]) {
    const f = fixture(t);
    assert.equal(f.run(args).status, 2);
    assert.deepEqual(f.commands(), []);
  }
});

test('native checks require an SDK configuration before running JavaScript checks', options, t => {
  const f = fixture(t);
  const result = f.run(['--android']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ANDROID_HOME/);
  assert.deepEqual(f.commands(), []);
});

test('native checks run core, phone and watch tests and lint through a non-executable wrapper', options, t => {
  const f = fixture(t);
  assert.equal(f.run(['--android'], { ANDROID_HOME: path.join(f.root, 'sdk') }).status, 0);
  const native = f.commands().at(-1);
  assert.equal(native.cwd, path.join(f.root, 'android'));
  assert.deepEqual(native.args, [
    'gradle', ':core:testDebugUnitTest', ':app:testDebugUnitTest', ':wear:testDebugUnitTest',
    ':app:lintRelease', ':wear:lintRelease',
  ]);
});

test('native checks accept SDK configuration in local.properties or ANDROID_SDK_ROOT', options, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'android/local.properties'), 'sdk.dir=/test/sdk\n');
  assert.equal(f.run(['--android']).status, 0);
  fs.unlinkSync(path.join(f.root, 'android/local.properties'));
  assert.equal(f.run(['--android'], { ANDROID_SDK_ROOT: '/test/sdk' }).status, 0);
});

test('native failures propagate to the caller', options, t => {
  const f = fixture(t);
  const result = f.run(['--android'], {
    ANDROID_HOME: '/test/sdk',
    CHECK_FAIL: 'gradle :core:testDebugUnitTest :app:testDebugUnitTest :wear:testDebugUnitTest :app:lintRelease :wear:lintRelease',
  });
  assert.equal(result.status, 7);
});
