import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

// Ein einziges Bundle: Server plus die geteilte Domain-Logik der App
// (`../src/domain`). Typ-Importe aus `../src/native` verschwinden dabei.
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
