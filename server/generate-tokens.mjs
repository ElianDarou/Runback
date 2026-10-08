import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(
  new URL('../src/ui/components.tsx', import.meta.url),
  'utf8',
);
const match =
  /\/\/ BEGIN SHARED DESIGN TOKENS\n([\s\S]*?)\/\/ END SHARED DESIGN TOKENS/.exec(
    source,
  );
if (!match)
  throw new Error('Shared design tokens are missing from components.tsx.');
mkdirSync(new URL('./.generated/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('./.generated/tokens.ts', import.meta.url),
  '// Generated from src/ui/components.tsx; edit it there.\n' + match[1],
);
