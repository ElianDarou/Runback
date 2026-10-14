// One local/CI entry point; native builds remain separate from validation.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--android') || args.length > 1) {
  console.error('Usage: npm run check [-- --android]');
  process.exit(2);
}
for (const binary of ['eslint', 'tsc', 'jest']) {
  if (!existsSync(path.join(root, 'node_modules', '.bin', binary))) {
    console.error('Dependencies are missing. Run npm ci in the repository first.');
    process.exit(1);
  }
}
const native = args.includes('--android');
const android = path.join(root, 'android');
if (native && !process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT &&
    !existsSync(path.join(android, 'local.properties'))) {
  console.error('Set ANDROID_HOME or ANDROID_SDK_ROOT, or add sdk.dir to android/local.properties.');
  process.exit(1);
}

function run(command, commandArgs, cwd = root) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env: { ...process.env, TZ: 'Europe/Berlin' },
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npm(commandArgs) {
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'npm', ...commandArgs]);
  } else {
    run('npm', commandArgs);
  }
}

npm(['run', 'lint']);
npm(['run', 'test:tooling']);
npm(['run', 'typecheck']);
npm(['test', '--', '--runInBand']);
if (native) {
  const tasks = [
    ':core:testDebugUnitTest', ':app:testDebugUnitTest', ':wear:testDebugUnitTest',
    ':app:lintRelease', ':wear:lintRelease',
  ];
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat', ...tasks], android);
  } else {
    run('bash', ['./gradlew', ...tasks], android);
  }
}
