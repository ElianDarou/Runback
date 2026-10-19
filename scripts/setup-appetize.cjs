const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Appetize cloud setup requires Node 24 or later for proxy support.');
  process.exit(1);
}
function run(file, args) {
  const result = spawnSync(process.execPath, ['--use-env-proxy', file, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(path.join(root, 'node_modules/@appetize/cli/cli.js'), ['--version']);
if (!existsSync(path.join(root, '.agents/skills/appetize/SKILL.md'))) {
  run(path.join(root, 'node_modules/@appetize/cli/cli.js'), [
    'skill', 'install', '--agent', 'codex', '--json', '--quiet',
  ]);
}
if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && !existsSync('/usr/bin/chromium')) {
  run(path.join(root, 'node_modules/playwright/cli.js'), ['install', 'chromium']);
}
console.log('Appetize CLI, project skill and Chromium are ready.');
if (!process.env.APPETIZE_API_TOKEN) {
  console.log('Uploads need APPETIZE_API_TOKEN in the cloud environment settings.');
}
