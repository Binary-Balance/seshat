import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

export const NODE_COMPARE_SOURCE = 'export const adult = (age: number) => age >= 18;\n';
export const NODE_COMPARE_OFFSET = Buffer.byteLength(
  NODE_COMPARE_SOURCE.slice(0, NODE_COMPARE_SOURCE.indexOf('>=')),
);
export const NODE_RULES_SOURCE = 'export const answer = () => 42;\n';

export const NODE_WORKSPACE_INPUT_PATHS = [
  'package.json',
  'tsconfig.json',
  'src',
  'packages',
  'node_modules/@seshat/rules',
  'tests',
];
export const NODE_WORKSPACE_INPUT_SHA256 = '653ef36d6390f8fdee150758411ad04f74aa4d68579ac369467ea5d6a66a8110';

export const NODE_WORKSPACE_EXPECTED = {
  name: 'node-workspace',
  sourceMetrics: {
    'packages/rules/index.ts': [[1, 1, 1, 1]],
    'src/compare.ts': [[1, 1, 1, 1]],
  },
  mutants: [
    {id: 0, localId: 0, offset: NODE_COMPARE_OFFSET, path: 'src/compare.ts', original: '>=', replacement: '>', verdict: 'killed'},
    {id: 1, localId: 1, offset: NODE_COMPARE_OFFSET, path: 'src/compare.ts', original: '>=', replacement: '<', verdict: 'killed'},
  ],
  score: 100,
  tests: 1,
};

function writeJson(path, value) {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeNodeWorkspace(project) {
  mkdirSync(join(project, 'src'), {recursive: true});
  mkdirSync(join(project, 'packages/rules'), {recursive: true});
  mkdirSync(join(project, 'tests'), {recursive: true});
  mkdirSync(join(project, 'node_modules/@seshat'), {recursive: true});
  writeJson(join(project, 'package.json'), {
    name: 'seshat-diagnostics-workspace',
    private: true,
    type: 'module',
    workspaces: ['packages/*'],
  });
  writeJson(join(project, 'packages/rules/package.json'), {
    name: '@seshat/rules',
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: './index.ts',
  });
  writeJson(join(project, 'tsconfig.json'), {
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      allowImportingTsExtensions: true,
    },
    include: ['src/**/*.ts', 'packages/**/*.ts'],
  });
  writeFileSync(join(project, 'packages/rules/index.ts'), NODE_RULES_SOURCE);
  writeFileSync(join(project, 'src/compare.ts'), NODE_COMPARE_SOURCE);
  assert.equal(readFileSync(join(project, 'src/compare.ts'), 'utf8'), NODE_COMPARE_SOURCE);
  writeFileSync(join(project, 'tests/check.mjs'), [
    "import {test} from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {adult} from '../src/compare.ts';",
    "import {answer} from '@seshat/rules';",
    "test('workspace rules', () => {",
    "  assert.deepEqual([adult(17), adult(18), adult(19)], [false, true, true]);",
    '  assert.equal(answer(), 42);',
    '});',
  ].join('\n') + '\n');
  symlinkSync('../../packages/rules', join(project, 'node_modules/@seshat/rules'));
  assert.equal(readlinkSync(join(project, 'node_modules/@seshat/rules')), '../../packages/rules');
}

export function nodeWorkspaceSeshatConfig({collector, compiler, nodeCommand, workers}) {
  const test = [nodeCommand, '--test', '--test-concurrency=1', '--test-reporter={seshatReporter}', 'tests/check.mjs'];
  return {
    workers,
    source: {include: ['src/**/*.ts', 'packages/**/*.ts']},
    capture: ['package.json', 'tsconfig.json', 'src', 'packages', 'node_modules', 'tests'],
    setups: [{
      name: 'node-workspace', runner: 'node', cwd: '.', timeoutMs: 60000,
      typecheck: [nodeCommand, compiler, '--project', 'tsconfig.json'],
      test,
      coverage: {command: [nodeCommand, collector, 'tests/check.mjs'], report: 'coverage/coverage-final.json'},
    }],
  };
}
