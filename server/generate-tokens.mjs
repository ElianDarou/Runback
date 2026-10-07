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
  throw new Error('Gemeinsame Design-Token fehlen in components.tsx.');
mkdirSync(new URL('./.generated/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('./.generated/tokens.ts', import.meta.url),
  '// Erzeugt aus src/ui/components.tsx; dort bearbeiten.\n' + match[1],
);
