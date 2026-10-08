import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// One single bundle: the server plus the app's shared domain logic
// (`../src/domain`). Type imports from `../src/native` disappear in the process.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url)),
);
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  define: {
    __RUNBACK_SERVER_VERSION__: JSON.stringify(
      process.env.RUNBACK_VERSION || version,
    ),
  },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
