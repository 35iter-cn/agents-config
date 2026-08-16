import { existsSync, mkdirSync } from 'node:fs';
import { ADJECTIVES } from './words/adjectives.mjs';
import { NOUNS } from './words/nouns.mjs';

export function generateTmpfilePath(options = {}) {
  const prefix = options.prefix ?? 'prompt';
  const dir = options.dir ?? '/tmp/companions';
  const ext = options.ext ?? '.md';
  const retries = options.retries ?? 10;

  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < retries; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const filename = `${prefix}-${adj}-${noun}${ext}`;
    const filepath = `${dir}/${filename}`;

    if (!existsSync(filepath)) {
      return filepath;
    }
  }

  throw new Error(`Failed to generate unique tmpfile path after ${retries} retries`);
}

export function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--prefix') {
      options.prefix = argv[i + 1];
      i += 1;
    } else if (current === '--dir') {
      options.dir = argv[i + 1];
      i += 1;
    } else if (current === '--ext') {
      options.ext = argv[i + 1];
      i += 1;
    }
  }
  const path = generateTmpfilePath(options);
  console.log(path);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
