import { generateTmpfilePath } from './lib/tmpfile.mjs';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert';

const testDir = '/tmp/test-tmpfile-' + Date.now();
mkdirSync(testDir, { recursive: true });

// Test 1: basic generation
const path1 = generateTmpfilePath({ dir: testDir });
assert(path1.startsWith(testDir + '/prompt-'), `Expected prefix prompt-, got: ${path1}`);
assert(path1.endsWith('.md'), `Expected suffix .md, got: ${path1}`);
assert(/prompt-[a-z]+-[a-z]+\.md$/.test(path1), `Expected adjective-noun pattern, got: ${path1}`);
console.log('✓ Test 1 passed: basic generation');

// Test 2: custom options
const path2 = generateTmpfilePath({ prefix: 'debug', ext: '.txt', dir: testDir });
assert(path2.startsWith(testDir + '/debug-'), `Expected prefix debug-, got: ${path2}`);
assert(path2.endsWith('.txt'), `Expected suffix .txt, got: ${path2}`);
console.log('✓ Test 2 passed: custom options');

// Test 3: collision avoidance
const existingFile = `${testDir}/prompt-happy-cat.md`;
writeFileSync(existingFile, '');
let path3;
for (let i = 0; i < 100; i++) {
  path3 = generateTmpfilePath({ dir: testDir });
  if (path3 !== existingFile) break;
}
assert(path3 !== existingFile, 'Expected collision avoidance to produce different path');
console.log('✓ Test 3 passed: collision avoidance');

// Test 4: directory auto-creation
const newDir = `${testDir}/nested/deep`;
const path4 = generateTmpfilePath({ dir: newDir });
assert(existsSync(newDir), 'Expected directory to be auto-created');
assert(path4.startsWith(newDir), `Expected path in new dir, got: ${path4}`);
console.log('✓ Test 4 passed: directory auto-creation');

// Cleanup
rmSync(testDir, { recursive: true, force: true });
console.log('\nAll tests passed!');
